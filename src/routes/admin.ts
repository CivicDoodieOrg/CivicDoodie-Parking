// Admin moderation JSON API. Every route is wrapped in requireAuth +
// requireAdmin; non-admins get 404 (not 403) so endpoint existence isn't
// leaked. Server-rendered admin UI can come later — for now this is the
// surface a frontend admin dashboard or curl-based moderation can drive.

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/admin";
import type { AuthEnv } from "../auth";

type Env = {
  Bindings: AuthEnv & {
    DB: D1Database;
    IMAGES: R2Bucket;
    ASSETS: Fetcher;
    ADMIN_USER_IDS: string;
  };
  Variables: {
    user: { id: string; email: string; name: string; image?: string | null };
    session: { id: string; userId: string; expiresAt: Date };
  };
};

export const admin = new Hono<Env>();

admin.use("/*", requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Reports queue
// ---------------------------------------------------------------------------

const REPORT_STATUSES = ["pending", "reviewed", "actioned", "dismissed"] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];

// GET /api/admin/reports?status=pending&page=&page_size=
admin.get("/reports", async (c) => {
  const status = c.req.query("status");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(c.req.query("page_size") ?? "50", 10) || 50)
  );
  const offset = (page - 1) * pageSize;

  let where = "1 = 1";
  const params: (string | number)[] = [];
  if (status && (REPORT_STATUSES as readonly string[]).includes(status)) {
    where = "r.status = ?";
    params.push(status);
  }

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM report r WHERE ${where}`
  )
    .bind(...params)
    .first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.target_type, r.target_id, r.reporter_id, r.reason, r.details,
            r.status, r.reviewed_at, r.reviewer_notes, r.created_at,
            ru.screen_name as reporter_screen_name
     FROM report r
     LEFT JOIN "user" ru ON ru.id = r.reporter_id
     WHERE ${where}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<{
      id: string;
      target_type: "doodie" | "comment";
      target_id: string;
      reporter_id: string;
      reason: string;
      details: string | null;
      status: ReportStatus;
      reviewed_at: string | null;
      reviewer_notes: string | null;
      created_at: string;
      reporter_screen_name: string | null;
    }>();

  return c.json({
    reports: rows.results ?? [],
    page,
    page_size: pageSize,
    total: totalRow?.n ?? 0,
  });
});

// PATCH /api/admin/reports/:id — set status + optional reviewer_notes.
admin.patch("/reports/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id")!;
  const body = await c.req
    .json<{ status?: unknown; reviewer_notes?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>);
  const status = typeof body.status === "string" ? body.status : "";
  if (!(REPORT_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      { error: `status must be one of: ${REPORT_STATUSES.join(", ")}` },
      400
    );
  }
  const notes =
    typeof body.reviewer_notes === "string"
      ? body.reviewer_notes.trim().slice(0, 1000)
      : null;

  const existing = await c.env.DB.prepare(
    `SELECT id, target_type, target_id FROM report WHERE id = ?`
  )
    .bind(id)
    .first<{
      id: string;
      target_type: "doodie" | "comment";
      target_id: string;
    }>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE report SET status = ?, reviewer_notes = ?,
                       reviewed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(status, notes, id)
    .run();

  // Audit on the parent doodie (or the comment's doodie) so the moderation
  // history is visible from the doodie page.
  let doodieId: string | null = null;
  if (existing.target_type === "doodie") {
    doodieId = existing.target_id;
  } else {
    const c2 = await c.env.DB.prepare(
      `SELECT doodie_id FROM doodie_comment WHERE id = ?`
    )
      .bind(existing.target_id)
      .first<{ doodie_id: string }>();
    doodieId = c2?.doodie_id ?? null;
  }
  if (doodieId) {
    await c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details)
       VALUES (?, ?, ?, 'report_reviewed', ?)`
    )
      .bind(
        crypto.randomUUID(),
        doodieId,
        user.id,
        JSON.stringify({ report_id: id, status })
      )
      .run();
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const USER_STATUSES = ["active", "restricted", "suspended", "banned"] as const;
type UserStatus = (typeof USER_STATUSES)[number];

// GET /api/admin/users?status=&q=&page=&page_size=
admin.get("/users", async (c) => {
  const statusFilter = c.req.query("status");
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(c.req.query("page_size") ?? "50", 10) || 50)
  );
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (
    statusFilter &&
    (USER_STATUSES as readonly string[]).includes(statusFilter)
  ) {
    where.push("status = ?");
    params.push(statusFilter);
  }
  if (q) {
    const pattern = q.replace(/[%_]/g, (m) => "\\" + m) + "%";
    where.push(
      "(screen_name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE OR id = ?)"
    );
    params.push(pattern, pattern, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM "user" ${whereSql}`
  )
    .bind(...params)
    .first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT id, name, email, screen_name, country, brownie_points, status, createdAt
     FROM "user"
     ${whereSql}
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<{
      id: string;
      name: string;
      email: string;
      screen_name: string | null;
      country: string | null;
      brownie_points: number;
      status: UserStatus;
      createdAt: string;
    }>();

  return c.json({
    users: rows.results ?? [],
    page,
    page_size: pageSize,
    total: totalRow?.n ?? 0,
  });
});

// PATCH /api/admin/users/:id — change status and/or adjust brownie_points.
// Body: { status?: UserStatus, brownie_points_delta?: number, reason?: string }
admin.patch("/users/:id", async (c) => {
  const actor = c.get("user");
  const id = c.req.param("id")!;
  const body = await c.req
    .json<{
      status?: unknown;
      brownie_points_delta?: unknown;
      reason?: unknown;
    }>()
    .catch(() => ({}) as Record<string, unknown>);

  const target = await c.env.DB.prepare(
    `SELECT id, status, brownie_points FROM "user" WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; status: UserStatus; brownie_points: number }>();
  if (!target) return c.json({ error: "Not found" }, 404);

  const updates: { col: string; val: string | number }[] = [];
  const audit: Record<string, unknown> = { reason: null };
  if (typeof body.reason === "string") audit.reason = body.reason.trim().slice(0, 500);

  if (typeof body.status === "string") {
    if (!(USER_STATUSES as readonly string[]).includes(body.status)) {
      return c.json(
        { error: `status must be one of: ${USER_STATUSES.join(", ")}` },
        400
      );
    }
    if (body.status !== target.status) {
      updates.push({ col: "status", val: body.status });
      audit.status = { from: target.status, to: body.status };
    }
  }

  if (typeof body.brownie_points_delta === "number") {
    const delta = Math.trunc(body.brownie_points_delta);
    if (Number.isFinite(delta) && delta !== 0) {
      const next = Math.max(target.brownie_points + delta, 0);
      updates.push({ col: "brownie_points", val: next });
      audit.brownie_points = {
        from: target.brownie_points,
        to: next,
        delta,
      };
    }
  }

  if (updates.length === 0) return c.json({ ok: true, changed: false });

  const setClause = updates.map((u) => `${u.col} = ?`).join(", ");
  await c.env.DB.prepare(
    `UPDATE "user" SET ${setClause}, updatedAt = datetime('now') WHERE id = ?`
  )
    .bind(...updates.map((u) => u.val), id)
    .run();

  // We don't have a global audit table — moderation actions on users that
  // aren't doodie-specific don't get persisted to doodie_audit. The
  // adjustments are visible by reading the user's current brownie_points
  // and status. A future global audit table can capture these if needed.
  // (Ack actor in response so the caller knows the action took.)
  return c.json({
    ok: true,
    changed: true,
    actor: { id: actor.id },
    audit,
  });
});

// GET /api/admin/users/:id — admin-only fuller profile (includes email,
// IP-bearing surfaces, etc. for moderation context).
admin.get("/users/:id", async (c) => {
  const id = c.req.param("id")!;
  const row = await c.env.DB.prepare(
    `SELECT id, name, email, screen_name, city, state_or_region, country,
            brownie_points, status, terms_accepted_at, createdAt
     FROM "user" WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!row) return c.json({ error: "Not found" }, 404);

  const accounts = await c.env.DB.prepare(
    `SELECT providerId, accountId, createdAt FROM "account" WHERE userId = ? ORDER BY createdAt`
  )
    .bind(id)
    .all<{ providerId: string; accountId: string; createdAt: string }>();
  const recentSessions = await c.env.DB.prepare(
    `SELECT id, ipAddress, userAgent, createdAt, expiresAt
     FROM "session" WHERE userId = ?
     ORDER BY createdAt DESC LIMIT 10`
  )
    .bind(id)
    .all<{
      id: string;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: string;
      expiresAt: string;
    }>();

  return c.json({
    user: row,
    accounts: accounts.results ?? [],
    recent_sessions: recentSessions.results ?? [],
  });
});
