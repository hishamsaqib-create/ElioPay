import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, PayslipEntry, getSettings } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getMonthName } from "@/lib/calculations";
import { generatePayslipPdf } from "@/lib/pdf-generator";
import nodemailer from "nodemailer";

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

  // Generate the full professional PDF
  const { buffer: pdfBuffer, filename } = await generatePayslipPdf(String(entry_id));

  // Get clinic name for email branding
  const appSettings = await getSettings();
  const clinicName = appSettings.get("clinic_name") || "AuraPay";

  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port || "587"),
    secure: false,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });

  try {
    await transporter.sendMail({
      from: `"${clinicName}" <${settings.email_from || "pm@auradentalclinic.co.uk"}>`,
      to: entry.dentist_email,
      subject: `Your Payslip - ${getMonthName(entry.month)} ${entry.year}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#0f172a;padding:20px;border-radius:8px 8px 0 0">
            <h1 style="color:#fff;margin:0;font-size:24px">${clinicName}</h1>
            <p style="color:#94a3b8;margin:5px 0 0">Dental Payslip Portal</p>
          </div>
          <div style="padding:25px;background:#fff;border:1px solid #e9ecef">
            <p>Dear ${entry.dentist_name},</p>
            <p>Please find your payslip for <strong>${getMonthName(entry.month)} ${entry.year}</strong> attached.</p>
            <p>If you have any questions regarding your payslip, please do not hesitate to get in touch.</p>
            <p style="margin-top:20px">Kind regards,</p>
            <p style="margin:2px 0"><strong>Mrs Jennifer Ingledew</strong></p>
            <p style="margin:2px 0;font-size:13px;color:#64748b">Practice Manager</p>
            <p style="margin:2px 0;font-size:13px;color:#64748b">Aura Dental Clinic</p>
          </div>
          <div style="padding:15px;text-align:center;font-size:11px;color:#adb5bd">
            ${clinicName}
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
