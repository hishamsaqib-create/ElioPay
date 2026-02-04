import { NextResponse } from "next/server";
import { getDb, rowsTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/admin - Get admin dashboard stats (super admin only)
export async function GET() {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized - Super admin access required" }, { status: 403 });
  }

  try {
    const db = await getDb();

    // Get all clinics
    const clinicsResult = await db.execute("SELECT * FROM clinics ORDER BY created_at DESC");
    const clinics = rowsTo<{
      id: number;
      name: string;
      slug: string;
      email: string | null;
      phone: string | null;
      active: number;
      created_at: string;
    }>(clinicsResult.rows);

    // Get all users with clinic info
    const usersResult = await db.execute(`
      SELECT u.*, c.name as clinic_name
      FROM users u
      LEFT JOIN clinics c ON c.id = u.clinic_id
      ORDER BY u.created_at DESC
    `);
    const users = rowsTo<{
      id: number;
      email: string;
      name: string;
      role: string;
      clinic_id: number | null;
      clinic_name: string | null;
      is_super_admin: number;
      created_at: string;
    }>(usersResult.rows);

    // Get total payslips generated
    const payslipsResult = await db.execute("SELECT COUNT(*) as count FROM payslip_entries");
    const totalPayslips = Number(payslipsResult.rows[0]?.count || 0);

    // Get total dentists
    const dentistsResult = await db.execute("SELECT COUNT(*) as count FROM dentists WHERE active = 1");
    const totalDentists = Number(dentistsResult.rows[0]?.count || 0);

    return NextResponse.json({
      stats: {
        totalClinics: clinics.length,
        activeClinics: clinics.filter(c => c.active === 1).length,
        totalUsers: users.length,
        superAdmins: users.filter(u => u.is_super_admin === 1).length,
        totalPayslips,
        totalDentists,
      },
      clinics,
      users: users.map(u => ({
        ...u,
        is_super_admin: u.is_super_admin === 1,
      })),
    });
  } catch (error) {
    console.error("[Admin] Error fetching stats:", error);
    return NextResponse.json({ error: "Failed to fetch admin data" }, { status: 500 });
  }
}
