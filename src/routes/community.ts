import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AuthEnv } from "../auth";
import { censor } from "../lib/banned-words";

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

const MESSAGE_MAX = 280;

type MessageRow = {
  id: string;
  author_name: string;
  body: string;
  flagged: number;
  created_at: string;
};

function toMessage(m: MessageRow) {
  return {
    id: m.id,
    author_name: m.author_name,
    body: m.body,
    flagged: Boolean(m.flagged),
    created_at: m.created_at,
  };
}

export const community = new Hono<Env>();

// GET /api/community/messages?limit=50 — public. Most recent N, oldest-first.
community.get("/messages", async (c) => {
  const raw = parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Math.min(100, Math.max(1, Number.isNaN(raw) ? 50 : raw));
  const rows = await c.env.DB.prepare(
    `SELECT id, author_name, body, flagged, created_at
       FROM community_message
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  )
    .bind(limit)
    .all<MessageRow>();
  const messages = (rows.results ?? []).map(toMessage).reverse();
  return c.json({ messages });
});

// POST /api/community/messages — requires sign-in. Censors + stores + flags.
community.post("/messages", requireAuth, async (c) => {
  const user = c.get("user");
  const parsed = await c.req
    .json<{ body?: unknown }>()
    .catch(() => ({}) as { body?: unknown });
  const text = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (text.length < 1 || text.length > MESSAGE_MAX) {
    return c.json({ error: `body must be 1–${MESSAGE_MAX} characters` }, 400);
  }

  const { body, flagged } = censor(text);

  // Anti-spam: block an exact repeat of the user's last message, and throttle
  // only after a burst of 5 messages within 30 seconds (the 6th gets 429).
  const last = await c.env.DB.prepare(
    `SELECT body FROM community_message
      WHERE user_id = ? ORDER BY rowid DESC LIMIT 1`
  )
    .bind(user.id)
    .first<{ body: string }>();
  if (last && last.body === body) {
    return c.json({ error: "That's the same as your last message." }, 429);
  }
  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM community_message
      WHERE user_id = ? AND created_at >= datetime('now', '-30 seconds')`
  )
    .bind(user.id)
    .first<{ n: number }>();
  if (recent && recent.n >= 5) {
    return c.json(
      { error: "You're posting too fast — slow down for a moment." },
      429
    );
  }

  const urow = await c.env.DB.prepare(
    `SELECT username, name FROM "user" WHERE id = ?`
  )
    .bind(user.id)
    .first<{ username: string | null; name: string | null }>();
  const authorName = urow?.username || urow?.name || "someone";

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO community_message (id, user_id, author_name, body, flagged)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, authorName, body, flagged ? 1 : 0)
    .run();

  const created = await c.env.DB.prepare(
    `SELECT id, author_name, body, flagged, created_at FROM community_message WHERE id = ?`
  )
    .bind(id)
    .first<MessageRow>();

  return c.json({ message: toMessage(created!) }, 201);
});
