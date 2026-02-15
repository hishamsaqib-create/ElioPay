import { NextRequest, NextResponse } from "next/server";
import { getDb, rowTo, rowsTo, PayslipEntry, getSettings } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getMonthName } from "@/lib/calculations";
import { generatePayslipPdf } from "@/lib/pdf-generator";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { period_id } = await req.json();
  if (!period_id) return NextResponse.json({ error: "period_id required" }, { status: 400 });

  const db = await getDb();

  // Get all entries for this period with dentist and period info
  const result = await db.execute({
    sql: `SELECT e.*, d.name as dentist_name, d.email as dentist_email,
            d.split_percentage, d.is_nhs, d.uda_rate, d.performer_number,
            p.month, p.year
     FROM payslip_entries e
     JOIN dentists d ON d.id = e.dentist_id
     JOIN pay_periods p ON p.id = e.period_id
     WHERE e.period_id = ?`,
    args: [period_id],
  });

  type EntryRow = PayslipEntry & {
    dentist_name: string; dentist_email: string | null;
    split_percentage: number; is_nhs: number; uda_rate: number;
    performer_number: string | null; month: number; year: number;
  };
  const entries = rowsTo<EntryRow>(result.rows);

  if (entries.length === 0) return NextResponse.json({ error: "No entries found" }, { status: 404 });

  // Filter entries with email addresses
  const entriesWithEmail = entries.filter(e => e.dentist_email);
  if (entriesWithEmail.length === 0) {
    return NextResponse.json({ error: "No dentists have email addresses configured" }, { status: 400 });
  }

  // Get SMTP settings
  const settingsResult = await db.execute("SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key = 'email_from'");
  const settings: Record<string, string> = {};
  for (const r of rowsTo<{ key: string; value: string }>(settingsResult.rows)) settings[r.key] = r.value;

  if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
    return NextResponse.json({ error: "SMTP not configured. Go to Settings to configure email." }, { status: 400 });
  }

  const appSettings = await getSettings();
  const clinicName = appSettings.get("clinic_name") || "AuraPay";

  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port || "587"),
    secure: false,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });

  const results: { dentist: string; status: "sent" | "failed"; error?: string }[] = [];

  for (const entry of entriesWithEmail) {
    try {
      const { buffer: pdfBuffer, filename } = await generatePayslipPdf(String(entry.id));

      await transporter.sendMail({
        from: `"Mrs Jennifer Ingledew - Practice Manager" <pm@auradentalclinic.co.uk>`,
        to: entry.dentist_email!,
        subject: `Your Payslip - ${getMonthName(entry.month)} ${entry.year}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#0f172a;padding:20px;border-radius:8px 8px 0 0">
              <h1 style="color:#fff;margin:0;font-size:24px">${clinicName}</h1>
              <p style="color:#94a3b8;margin:5px 0 0">Payslip Notification</p>
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

      await db.execute({
        sql: "INSERT INTO email_log (payslip_entry_id, dentist_id, status) VALUES (?, ?, 'sent')",
        args: [entry.id, entry.dentist_id],
      });
      results.push({ dentist: entry.dentist_name, status: "sent" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await db.execute({
        sql: "INSERT INTO email_log (payslip_entry_id, dentist_id, status, error) VALUES (?, ?, 'failed', ?)",
        args: [entry.id, entry.dentist_id, errMsg],
      });
      results.push({ dentist: entry.dentist_name, status: "failed", error: errMsg });
    }
  }

  const sent = results.filter(r => r.status === "sent").length;
  const failed = results.filter(r => r.status === "failed").length;
  const skipped = entries.length - entriesWithEmail.length;

  return NextResponse.json({
    ok: true,
    message: `${sent} email${sent !== 1 ? "s" : ""} sent${failed > 0 ? `, ${failed} failed` : ""}${skipped > 0 ? `, ${skipped} skipped (no email)` : ""}`,
    results,
  });
}
