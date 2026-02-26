import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const type = formData.get("type") as string; // "lab" or "supplier"
    const entityName = formData.get("entity_name") as string;

    if (!file || !type || !entityName) {
      return NextResponse.json({ error: "Missing required fields: file, type, entity_name" }, { status: 400 });
    }

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Only PDF and images allowed." }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum 5MB allowed." }, { status: 400 });
    }

    const timestamp = Date.now();
    const sanitizedName = entityName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
    const ext = file.name.split(".").pop() || "pdf";
    const folder = type === "lab" ? "lab-bill-entries" : "supplier-invoices";
    const filename = `${folder}/${sanitizedName}_${timestamp}.${ext}`;

    const blob = await put(filename, file, { access: "public", addRandomSuffix: false });

    return NextResponse.json({ ok: true, file_url: blob.url });
  } catch (error) {
    console.error("[Bill Upload] Error:", error);
    return NextResponse.json(
      { error: "Upload failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
