import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Correct Dentally user IDs (from /api/dentally/debug)
const CORRECT_IDS: Record<string, string> = {
  "Hisham Saqib": "276544",
  "Ankush Patel": "285115",
  "Peter Throw": "396225",
  "Priyanka Kapoor": "396229",
  "Zeeshan Abbas": "484388",
  "Moneeb Ahmad": "497281",
  "Hani Dalati": "462017",
  "Syed Abdullah": "367953",
};

async function updateIds() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const updates: string[] = [];

  for (const [name, newId] of Object.entries(CORRECT_IDS)) {
    await db.execute({
      sql: "UPDATE dentists SET practitioner_id = ? WHERE name = ?",
      args: [newId, name],
    });
    updates.push(`${name} → ${newId}`);
  }

  return NextResponse.json({
    message: "Updated dentist IDs",
    updates,
  });
}

export async function GET() {
  return updateIds();
}

export async function POST() {
  return updateIds();
}
