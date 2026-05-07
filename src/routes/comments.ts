import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { createAuth, type AuthEnv } from "../auth";

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

const COMMENT_MAX = 1000;

// Helpers ---------------------------------------------------------------

function isAdmin(user: { id: string }, adminEnv: string | undefined): boolean {
  const ids = (adminEnv || "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(user.id);
}

async function profileGate(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT screen_name, country, terms_accepted_at FROM "user" WHERE id = ?`
    )
    .bind(userId)
    .first<{
      screen_name: string | null;
      country: string | null;
      terms_accepted_at: string | null;
    }>();
  if (!row?.screen_name) return "Pick a screen name first.";
  if (!row.country) return "Set your country before contributing.";
  if (!row.terms_accepted_at)
    return "Accept the Terms of Service before contributing.";
  return null;
}

function ipOf(c: { req: { header: (n: string) => string | undefined } }): string | null {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || null;
}

interface DoodieRef {
  id: string;
  reporter_id: string;
  moderation_status: "pending" | "approved" | "flagged" | "removed";
}

async function loadDoodieByTownAndSlug(
  db: D1Database,
  townSlug: string,
  doodieSlug: string
): Promise<DoodieRef | null> {
  return db
    .prepare(
      `SELECT d.id, d.reporter_id, d.moderation_status
       FROM doodie d
       JOIN town t ON t.id = d.town_id
       WHERE t.slug = ? AND d.slug = ?`
    )
    .bind(townSlug, doodieSlug)
    .first<DoodieRef>();
}

function canSeeDoodie(
  viewerId: string | null,
  doodie: DoodieRef,
  viewerIsAdmin: boolean
): boolean {
  if (doodie.moderation_status === "approved") return true;
  if (doodie.moderation_status === "removed" && !viewerIsAdmin) return false;
  if (!viewerId) return false;
  if (viewerId === doodie.reporter_id) return true;
  return viewerIsAdmin;
}

// Best-effort session lookup for endpoints that don't require auth.
async function softViewer(c: {
  env: Env["Bindings"];
  req: { raw: Request };
}): Promise<{ id: string; isAdmin: boolean } | null> {
  try {
    const auth = createAuth(c.env.DB, c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return null;
    return {
      id: session.user.id,
      isAdmin: isAdmin(session.user, c.env.ADMIN_USER_IDS),
    };
  } catch {
    return null;
  }
}

// =========================================================================
// doodieComments — mounted at /api/towns/:townSlug/doodies/:doodieSlug/comments
// =========================================================================

export const doodieComments = new Hono<Env>();

interface CommentRow {
  id: string;
  doodie_id: string;
  user_id: string;
  body: string;
  upvotes_count: number;
  downvotes_count: number;
  censored: number;
  created_at: string;
}

function publicComment(
  c: CommentRow & { author_screen_name: string | null },
  viewerIsAdmin: boolean
) {
  const censored = Boolean(c.censored);
  return {
    id: c.id,
    doodie_id: c.doodie_id,
    author: { screen_name: c.author_screen_name ?? "(deleted)" },
    body: censored && !viewerIsAdmin ? "[censored]" : c.body,
    upvotes_count: c.upvotes_count,
    downvotes_count: c.downvotes_count,
    censored,
    created_at: c.created_at,
  };
}

// GET — list comments on a doodie. Public when the doodie is. Censored
// bodies are masked for non-admins; the row itself is still returned so the
// thread structure is intact and the censoring is visible.
doodieComments.get("/", async (c) => {
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const doodie = await loadDoodieByTownAndSlug(c.env.DB, townSlug, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const viewer = await softViewer(c);
  if (!canSeeDoodie(viewer?.id ?? null, doodie, viewer?.isAdmin ?? false)) {
    return c.json({ error: "Not found" }, 404);
  }

  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(c.req.query("page_size") ?? "50", 10) || 50)
  );
  const offset = (page - 1) * pageSize;

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM doodie_comment WHERE doodie_id = ?`
  )
    .bind(doodie.id)
    .first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.doodie_id, c.user_id, c.body, c.upvotes_count, c.downvotes_count,
            c.censored, c.created_at, u.screen_name as author_screen_name
     FROM doodie_comment c
     LEFT JOIN "user" u ON u.id = c.user_id
     WHERE c.doodie_id = ?
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT ? OFFSET ?`
  )
    .bind(doodie.id, pageSize, offset)
    .all<CommentRow & { author_screen_name: string | null }>();

  return c.json({
    comments: (rows.results ?? []).map((r) =>
      publicComment(r, viewer?.isAdmin ?? false)
    ),
    page,
    page_size: pageSize,
    total: totalRow?.n ?? 0,
  });
});

// POST — file a comment. Profile-complete gate. Maintains
// doodie.comments_count denormalized in the same batch.
doodieComments.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const townSlug = c.req.param("townSlug")!;
  const doodieSlug = c.req.param("doodieSlug")!;
  const doodie = await loadDoodieByTownAndSlug(c.env.DB, townSlug, doodieSlug);
  if (!doodie) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  if (!canSeeDoodie(user.id, doodie, admin)) {
    return c.json({ error: "Not found" }, 404);
  }
  if (doodie.moderation_status !== "approved") {
    return c.json(
      { error: "Comments are only allowed on approved Doodies." },
      400
    );
  }

  const gateError = await profileGate(c.env.DB, user.id);
  if (gateError) return c.json({ error: gateError }, 412);

  const body = await c.req
    .json<{ body?: unknown }>()
    .catch(() => ({}) as { body?: unknown });
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length < 1 || text.length > COMMENT_MAX) {
    return c.json(
      { error: `body must be 1–${COMMENT_MAX} characters` },
      400
    );
  }

  const ip = ipOf(c);
  const commentId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO doodie_comment (id, doodie_id, user_id, body, ip_address)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(commentId, doodie.id, user.id, text, ip),
    c.env.DB.prepare(
      `UPDATE doodie SET comments_count = comments_count + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(doodie.id),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details, ip_address)
       VALUES (?, ?, ?, 'commented', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      doodie.id,
      user.id,
      JSON.stringify({ comment_id: commentId }),
      ip
    ),
  ]);

  return c.json({ id: commentId }, 201);
});

// =========================================================================
// comments — mounted at /api/comments (ID-scoped actions)
// =========================================================================

export const comments = new Hono<Env>();

interface CommentWithDoodie {
  id: string;
  doodie_id: string;
  user_id: string;
  upvotes_count: number;
  downvotes_count: number;
  censored: number;
  doodie_reporter_id: string;
  doodie_moderation_status: "pending" | "approved" | "flagged" | "removed";
}

async function loadComment(
  db: D1Database,
  commentId: string
): Promise<CommentWithDoodie | null> {
  return db
    .prepare(
      `SELECT c.id, c.doodie_id, c.user_id, c.upvotes_count, c.downvotes_count,
              c.censored,
              d.reporter_id as doodie_reporter_id,
              d.moderation_status as doodie_moderation_status
       FROM doodie_comment c
       JOIN doodie d ON d.id = c.doodie_id
       WHERE c.id = ?`
    )
    .bind(commentId)
    .first<CommentWithDoodie>();
}

// POST /api/comments/:id/vote — toggle/switch vote.
comments.post("/:commentId/vote", requireAuth, async (c) => {
  const user = c.get("user");
  const commentId = c.req.param("commentId")!;
  const comment = await loadComment(c.env.DB, commentId);
  if (!comment) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  if (
    !canSeeDoodie(
      user.id,
      {
        id: comment.doodie_id,
        reporter_id: comment.doodie_reporter_id,
        moderation_status: comment.doodie_moderation_status,
      },
      admin
    )
  ) {
    return c.json({ error: "Not found" }, 404);
  }
  if (comment.user_id === user.id) {
    return c.json({ error: "Cannot vote on your own comment." }, 400);
  }
  if (comment.doodie_moderation_status !== "approved") {
    return c.json({ error: "Voting only allowed on approved Doodies." }, 400);
  }

  const gateError = await profileGate(c.env.DB, user.id);
  if (gateError) return c.json({ error: gateError }, 412);

  const body = await c.req
    .json<{ vote?: unknown }>()
    .catch(() => ({}) as { vote?: unknown });
  const requested = body.vote;
  if (
    requested !== "up" &&
    requested !== "down" &&
    requested !== null &&
    requested !== undefined
  ) {
    return c.json({ error: 'vote must be "up", "down", or null' }, 400);
  }
  const newVote: "up" | "down" | null =
    requested === "up" || requested === "down" ? requested : null;

  const existing = await c.env.DB.prepare(
    `SELECT vote_type FROM doodie_comment_vote WHERE comment_id = ? AND user_id = ?`
  )
    .bind(commentId, user.id)
    .first<{ vote_type: "up" | "down" }>();
  const oldVote: "up" | "down" | null = existing?.vote_type ?? null;

  if (oldVote === newVote) {
    return c.json({
      vote: newVote,
      upvotes_count: comment.upvotes_count,
      downvotes_count: comment.downvotes_count,
    });
  }

  const upDelta = (newVote === "up" ? 1 : 0) - (oldVote === "up" ? 1 : 0);
  const downDelta = (newVote === "down" ? 1 : 0) - (oldVote === "down" ? 1 : 0);

  const stmts = [];
  if (newVote === null) {
    stmts.push(
      c.env.DB.prepare(
        `DELETE FROM doodie_comment_vote WHERE comment_id = ? AND user_id = ?`
      ).bind(commentId, user.id)
    );
  } else if (oldVote === null) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO doodie_comment_vote (comment_id, user_id, vote_type) VALUES (?, ?, ?)`
      ).bind(commentId, user.id, newVote)
    );
  } else {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE doodie_comment_vote SET vote_type = ?, created_at = datetime('now')
         WHERE comment_id = ? AND user_id = ?`
      ).bind(newVote, commentId, user.id)
    );
  }
  stmts.push(
    c.env.DB.prepare(
      `UPDATE doodie_comment SET upvotes_count = upvotes_count + ?,
                                  downvotes_count = downvotes_count + ?
       WHERE id = ?`
    ).bind(upDelta, downDelta, commentId)
  );
  await c.env.DB.batch(stmts);

  return c.json({
    vote: newVote,
    upvotes_count: comment.upvotes_count + upDelta,
    downvotes_count: comment.downvotes_count + downDelta,
  });
});

// POST /api/comments/:id/report — file an abuse report on a comment.
comments.post("/:commentId/report", requireAuth, async (c) => {
  const user = c.get("user");
  const commentId = c.req.param("commentId")!;
  const comment = await loadComment(c.env.DB, commentId);
  if (!comment) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  if (
    !canSeeDoodie(
      user.id,
      {
        id: comment.doodie_id,
        reporter_id: comment.doodie_reporter_id,
        moderation_status: comment.doodie_moderation_status,
      },
      admin
    )
  ) {
    return c.json({ error: "Not found" }, 404);
  }
  if (comment.user_id === user.id) {
    return c.json({ error: "Cannot report your own comment." }, 400);
  }

  const gateError = await profileGate(c.env.DB, user.id);
  if (gateError) return c.json({ error: gateError }, 412);

  const body = await c.req
    .json<{ reason?: unknown; details?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>);
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 100) : "";
  if (reason.length === 0) {
    return c.json({ error: "reason is required" }, 400);
  }
  const details =
    typeof body.details === "string" ? body.details.trim().slice(0, 1000) : null;

  const reportId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO report (id, target_type, target_id, reporter_id, reason, details, ip_address)
       VALUES (?, 'comment', ?, ?, ?, ?, ?)`
    ).bind(reportId, commentId, user.id, reason, details, ipOf(c)),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details, ip_address)
       VALUES (?, ?, ?, 'comment_reported', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      comment.doodie_id,
      user.id,
      JSON.stringify({ comment_id: commentId, report_id: reportId, reason }),
      ipOf(c)
    ),
  ]);

  return c.json({ ok: true });
});

// PATCH /api/comments/:id — admin censor toggle.
// Body: { censored: boolean }
comments.patch("/:commentId", requireAuth, async (c) => {
  const user = c.get("user");
  if (!isAdmin(user, c.env.ADMIN_USER_IDS)) {
    return c.json({ error: "Not found" }, 404);
  }
  const commentId = c.req.param("commentId")!;
  const comment = await loadComment(c.env.DB, commentId);
  if (!comment) return c.json({ error: "Not found" }, 404);

  const body = await c.req
    .json<{ censored?: unknown }>()
    .catch(() => ({}) as { censored?: unknown });
  if (typeof body.censored !== "boolean") {
    return c.json({ error: "censored (boolean) is required" }, 400);
  }
  const newVal = body.censored ? 1 : 0;
  if (newVal === comment.censored) return c.json({ ok: true, changed: false });

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE doodie_comment SET censored = ? WHERE id = ?`).bind(
      newVal,
      commentId
    ),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details, ip_address)
       VALUES (?, ?, ?, 'comment_censored', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      comment.doodie_id,
      user.id,
      JSON.stringify({ comment_id: commentId, censored: Boolean(newVal) }),
      ipOf(c)
    ),
  ]);

  return c.json({ ok: true, changed: true, censored: Boolean(newVal) });
});

// DELETE /api/comments/:id — owner or admin. Hard delete; cascade drops votes.
comments.delete("/:commentId", requireAuth, async (c) => {
  const user = c.get("user");
  const commentId = c.req.param("commentId")!;
  const comment = await loadComment(c.env.DB, commentId);
  if (!comment) return c.json({ error: "Not found" }, 404);

  const admin = isAdmin(user, c.env.ADMIN_USER_IDS);
  const isOwner = comment.user_id === user.id;
  if (!isOwner && !admin) return c.json({ error: "Not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM doodie_comment WHERE id = ?`).bind(commentId),
    c.env.DB.prepare(
      `UPDATE doodie SET comments_count = MAX(comments_count - 1, 0) WHERE id = ?`
    ).bind(comment.doodie_id),
    c.env.DB.prepare(
      `INSERT INTO doodie_audit (id, doodie_id, actor_id, action, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      comment.doodie_id,
      user.id,
      isOwner ? "comment_deleted" : "comment_removed",
      JSON.stringify({ comment_id: commentId }),
      ipOf(c)
    ),
  ]);

  return c.json({ ok: true });
});
