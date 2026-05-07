import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
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

export const profile = new Hono<Env>();

// GET /api/profile — current user (no email/IP exposed)
profile.get("/", requireAuth, async (c) => {
  const user = c.get("user");

  const row = await c.env.DB.prepare(
    `SELECT screen_name, city, state_or_region, country, brownie_points, status, terms_accepted_at
     FROM "user" WHERE id = ?`
  )
    .bind(user.id)
    .first<{
      screen_name: string | null;
      city: string | null;
      state_or_region: string | null;
      country: string | null;
      brownie_points: number;
      status: string;
      terms_accepted_at: string | null;
    }>();

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      image: user.image ?? null,
      screen_name: row?.screen_name ?? null,
      city: row?.city ?? null,
      state_or_region: row?.state_or_region ?? null,
      country: row?.country ?? null,
      brownie_points: row?.brownie_points ?? 0,
      status: row?.status ?? "active",
      terms_accepted_at: row?.terms_accepted_at ?? null,
      profile_complete: Boolean(row?.country && row?.terms_accepted_at),
    },
  });
});

// PATCH /api/profile — set city / state / country (the post-OAuth completion step)
profile.patch("/", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    city?: string | null;
    state_or_region?: string | null;
    country?: string | null;
  }>();

  const country = body.country?.trim().toUpperCase().slice(0, 2) || null;
  const state = body.state_or_region?.trim().slice(0, 64) || null;
  const city = body.city?.trim().slice(0, 80) || null;

  if (country !== null && !/^[A-Z]{2}$/.test(country)) {
    return c.json({ error: "country must be a 2-letter ISO code" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE "user" SET city = ?, state_or_region = ?, country = ?, updatedAt = datetime('now') WHERE id = ?`
  )
    .bind(city, state, country, user.id)
    .run();

  return c.json({ ok: true });
});

// POST /api/profile/accept-terms — record ToS acceptance
profile.post("/accept-terms", requireAuth, async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare(
    `UPDATE "user" SET terms_accepted_at = datetime('now') WHERE id = ?`
  )
    .bind(user.id)
    .run();
  return c.json({ ok: true });
});
