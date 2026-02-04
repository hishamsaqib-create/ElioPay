import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, PayslipEntry, Dentist } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calculatePayslip, formatCurrency, getMonthName } from "@/lib/calculations";
import nodemailer from "nodemailer";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: Record<string, unknown>) => jsPDF;
    lastAutoTable: { finalY: number };
  }
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { entry_id } = await req.json();
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT e.*, d.name as dentist_name, d.email as dentist_email,
            d.split_percentage, d.is_nhs, d.uda_rate, d.performer_number,
            p.month, p.year
     FROM payslip_entries e
     JOIN dentists d ON d.id = e.dentist_id
     JOIN pay_periods p ON p.id = e.period_id
     WHERE e.id = ?`,
    args: [entry_id],
  });

  if (result.rows.length === 0) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  type EntryRow = PayslipEntry & {
    dentist_name: string; dentist_email: string | null;
    split_percentage: number; is_nhs: number; uda_rate: number;
    performer_number: string | null; month: number; year: number;
  };
  const entry = rowTo<EntryRow>(result.rows[0]);

  if (!entry.dentist_email) return NextResponse.json({ error: "Dentist has no email address" }, { status: 400 });

  // Get SMTP settings
  const settingsResult = await db.execute("SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key = 'email_from'");
  const settings: Record<string, string> = {};
  for (const r of rowsTo<{ key: string; value: string }>(settingsResult.rows)) settings[r.key] = r.value;

  if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
    return NextResponse.json({ error: "SMTP not configured. Go to Settings to configure email." }, { status: 400 });
  }

  const dentist: Dentist = {
    id: entry.dentist_id, name: entry.dentist_name, email: entry.dentist_email,
    split_percentage: entry.split_percentage, is_nhs: entry.is_nhs,
    uda_rate: entry.uda_rate, performer_number: entry.performer_number,
    practitioner_id: null, active: 1,
  };
  const calc = calculatePayslip(entry, dentist);

  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(66, 99, 235);
  doc.rect(0, 0, pw, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("ElioPay", 15, 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Payslip: ${entry.dentist_name} - ${getMonthName(entry.month)} ${entry.year}`, 15, 32);

  let y = 50;
  doc.setTextColor(0);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`Net Pay: ${formatCurrency(calc.netPay)}`, 15, y);
  y += 12;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const lines = [
    `Gross Private: ${formatCurrency(calc.grossPrivate)}`,
    `Net Private (${calc.splitPercentage}%): ${formatCurrency(calc.netPrivate)}`,
    ...(dentist.is_nhs ? [`NHS Income (${calc.nhsUdas} UDAs): ${formatCurrency(calc.nhsIncome)}`] : []),
    `Lab Bills Deduction: ${formatCurrency(calc.labBillsDeduction)}`,
    `Finance Fees: ${formatCurrency(calc.financeFeesDeduction)}`,
    `Therapy: ${formatCurrency(calc.therapyDeduction)}`,
    `Total Deductions: ${formatCurrency(calc.totalDeductions)}`,
  ];
  for (const line of lines) { doc.text(line, 15, y); y += 7; }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `${entry.dentist_name.replace(/\s+/g, "_")}_${getMonthName(entry.month)}_${entry.year}.pdf`;

  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port || "587"),
    secure: false,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });

  try {
    await transporter.sendMail({
      from: `"ElioPay" <${settings.email_from || settings.smtp_user}>`,
      to: entry.dentist_email,
      subject: `Your Payslip - ${getMonthName(entry.month)} ${entry.year}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#4263eb;padding:20px;border-radius:8px 8px 0 0">
            <h1 style="color:#fff;margin:0;font-size:24px">ElioPay™</h1>
            <p style="color:#bac8ff;margin:5px 0 0">Dental Payslip Portal</p>
          </div>
          <div style="padding:25px;background:#fff;border:1px solid #e9ecef">
            <p>Dear ${entry.dentist_name},</p>
            <p>Please find your payslip for <strong>${getMonthName(entry.month)} ${entry.year}</strong> attached.</p>
            <div style="background:#f8f9fa;border-radius:8px;padding:15px;margin:20px 0">
              <p style="margin:0;font-size:14px;color:#868e96">Net Pay</p>
              <p style="margin:5px 0 0;font-size:28px;font-weight:bold;color:#212529">${formatCurrency(calc.netPay)}</p>
            </div>
            <p style="font-size:13px;color:#868e96">This payslip was generated by ElioPay™. If you have questions, please contact the practice manager.</p>
          </div>
          <div style="padding:15px;text-align:center;font-size:11px;color:#adb5bd">
            Powered by ElioPay™ | eliopay.co.uk
          </div>
        </div>
      `,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
    });

    await db.execute({ sql: "INSERT INTO email_log (payslip_entry_id, dentist_id, status) VALUES (?, ?, 'sent')", args: [entry.id, entry.dentist_id] });
    return NextResponse.json({ ok: true, message: `Email sent to ${entry.dentist_email}` });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    await db.execute({ sql: "INSERT INTO email_log (payslip_entry_id, dentist_id, status, error) VALUES (?, ?, 'failed', ?)", args: [entry.id, entry.dentist_id, errMsg] });
    return NextResponse.json({ error: `Failed to send: ${errMsg}` }, { status: 500 });
  }
}
