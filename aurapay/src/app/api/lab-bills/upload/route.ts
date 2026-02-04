import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const entryId = formData.get("entry_id") as string;
    const labName = formData.get("lab_name") as string;
    const amount = formData.get("amount") as string;
    const description = formData.get("description") as string;

    if (!file || !entryId || !labName || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: file, entry_id, lab_name, amount" },
        { status: 400 }
      );
    }

    // Validate file type (PDF or images)
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only PDF and images allowed." },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum 5MB allowed." },
        { status: 400 }
      );
    }

    // Upload to Vercel Blob
    const timestamp = Date.now();
    const sanitizedLabName = labName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
    const ext = file.name.split(".").pop() || "pdf";
    const filename = `lab-bills/${entryId}/${sanitizedLabName}_${timestamp}.${ext}`;

    const blob = await put(filename, file, {
      access: "public",
      addRandomSuffix: false,
    });

    // Get current lab bills from entry
    const db = await getDb();
    const entry = await db.execute({
      sql: "SELECT lab_bills_json FROM payslip_entries WHERE id = ?",
      args: [entryId],
    });

    if (entry.rows.length === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    // Parse existing lab bills and add new one
    const labBills = JSON.parse(String(entry.rows[0].lab_bills_json || "[]"));
    labBills.push({
      lab_name: labName,
      amount: parseFloat(amount),
      description: description || "",
      file_url: blob.url,
      uploaded_at: new Date().toISOString(),
    });

    // Update entry with new lab bill
    await db.execute({
      sql: "UPDATE payslip_entries SET lab_bills_json = ?, updated_at = datetime('now') WHERE id = ?",
      args: [JSON.stringify(labBills), entryId],
    });

    return NextResponse.json({
      success: true,
      lab_bill: {
        lab_name: labName,
        amount: parseFloat(amount),
        description,
        file_url: blob.url,
      },
    });
  } catch (error) {
    console.error("[Lab Bill Upload] Error:", error);
    return NextResponse.json(
      { error: "Upload failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
