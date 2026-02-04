import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsTo } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface AuditLogEntry {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string;
  ip_address: string | null;
  created_at: string;
}

// GET /api/admin/audit - Get audit log (super admin only)
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 100), 500);
  const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
  const action = req.nextUrl.searchParams.get("action");
  const entityType = req.nextUrl.searchParams.get("entity_type");
  const userId = req.nextUrl.searchParams.get("user_id");

  try {
    const db = await getDb();

    // Build query with filters
    let sql = `
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE 1=1
    `;
    const args: (string | number)[] = [];

    if (action) {
      sql += " AND a.action LIKE ?";
      args.push(`%${action}%`);
    }

    if (entityType) {
      sql += " AND a.entity_type = ?";
      args.push(entityType);
    }

    if (userId) {
      sql += " AND a.user_id = ?";
      args.push(Number(userId));
    }

    // Get total count for pagination
    const countResult = await db.execute({
      sql: sql.replace("SELECT a.*, u.name as user_name, u.email as user_email", "SELECT COUNT(*) as count"),
      args,
    });
    const total = Number(countResult.rows[0]?.count || 0);

    // Get paginated results
    sql += " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);

    const result = await db.execute({ sql, args });

    const entries = rowsTo<AuditLogEntry>(result.rows).map(e => ({
      ...e,
      details: safeJsonParse(e.details),
    }));

    return NextResponse.json({
      entries,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + entries.length < total,
      },
    });
  } catch (error) {
    console.error("[Admin Audit] Error:", error);
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }
}

function safeJsonParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Helper function to log audit entries (exported for use in other routes)
export async function logAudit(
  userId: number,
  action: string,
  entityType: string,
  entityId: number | null,
  details?: Record<string, unknown>,
  req?: NextRequest
) {
  try {
    const db = await getDb();
    const ipAddress = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req?.headers.get("x-real-ip") || null;
    const userAgent = req?.headers.get("user-agent")?.substring(0, 255) || null;

    await db.execute({
      sql: `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [userId, action, entityType, entityId, JSON.stringify(details || {}), ipAddress, userAgent],
    });
  } catch (error) {
    console.error("[Audit] Failed to log:", error);
  }
}
