import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AuthEnv } from "../auth";
import { validateScreenName } from "../lib/slug";
import { generateScreenNameSuggestion } from "../lib/name-generator";

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

// GET /api/profile — full profile for the signed-in user.
// Includes private fields (email, linked OAuth accounts) — caller is the user
// themselves, so safe to expose. Public-facing user data lives at
// /api/users/:screen_name (separate, redacted).
profile.get("/", requireAuth, async (c) => {
  const user = c.get("user");

  const row = await c.env.DB.prepare(
    `SELECT screen_name, city, state_or_region, country, brownie_points,
            status, role, terms_accepted_at, createdAt
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
      role: string;
      terms_accepted_at: string | null;
      createdAt: string;
    }>();

  // All linked OAuth accounts (provider + provider's account ID).
  const accountRows = await c.env.DB.prepare(
    `SELECT providerId, accountId, createdAt
     FROM "account" WHERE userId = ?
     ORDER BY createdAt ASC`
  )
    .bind(user.id)
    .all<{ providerId: string; accountId: string; createdAt: string }>();

  const accounts = (accountRows.results ?? []).map((r) => ({
    provider: r.providerId,
    account_id: r.accountId,
    linked_at: r.createdAt,
  }));

  // Suggest a default screen name (only meaningful when current is null).
  // Random adj-noun-num — never derived from the user's real name.
  const suggestion = row?.screen_name ? null : generateScreenNameSuggestion();

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      screen_name: row?.screen_name ?? null,
      screen_name_suggestion: suggestion,
      city: row?.city ?? null,
      state_or_region: row?.state_or_region ?? null,
      country: row?.country ?? null,
      brownie_points: row?.brownie_points ?? 0,
      status: row?.status ?? "active",
      role: row?.role ?? "user",
      terms_accepted_at: row?.terms_accepted_at ?? null,
      created_at: row?.createdAt ?? null,
      profile_complete: Boolean(row?.screen_name && row?.country && row?.terms_accepted_at),
      accounts,
    },
  });
});

// GET /api/profile/screen-name/suggest — fresh random suggestion. Used by the
// onboarding form's "Try another" button. Doesn't claim or persist anything.
profile.get("/screen-name/suggest", requireAuth, async (c) => {
  return c.json({ suggestion: generateScreenNameSuggestion() });
});

// GET /api/profile/screen-name/check?name=foo — live availability check used
// by the onboarding form. Returns 200 always; the body indicates the verdict.
profile.get("/screen-name/check", requireAuth, async (c) => {
  const name = (c.req.query("name") ?? "").trim();
  const validationError = validateScreenName(name);
  if (validationError) {
    return c.json({ available: false, reason: "invalid", message: validationError });
  }
  // Uniqueness is case-insensitive — "Foo" and "foo" are the same name.
  const taken = await c.env.DB.prepare(
    `SELECT 1 FROM "user" WHERE screen_name = ? COLLATE NOCASE`
  )
    .bind(name)
    .first();
  if (taken) {
    return c.json({ available: false, reason: "taken", message: "Already in use." });
  }
  return c.json({ available: true });
});

// POST /api/profile/screen-name — one-time set, immutable thereafter.
// Body: { screen_name: string }
profile.post("/screen-name", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ screen_name?: unknown }>()
    .catch(() => ({}) as { screen_name?: unknown });
  const requested =
    typeof body.screen_name === "string" ? body.screen_name.trim() : "";

  const validationError = validateScreenName(requested);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  // Check immutability: reject if user already has one set.
  const current = await c.env.DB.prepare(
    `SELECT screen_name FROM "user" WHERE id = ?`
  )
    .bind(user.id)
    .first<{ screen_name: string | null }>();
  if (current?.screen_name) {
    return c.json(
      { error: "Screen name is already set and cannot be changed." },
      409
    );
  }

  // Try to claim it. UNIQUE constraint catches concurrent claims.
  try {
    await c.env.DB.prepare(
      `UPDATE "user" SET screen_name = ?, updatedAt = datetime('now') WHERE id = ?`
    )
      .bind(requested, user.id)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return c.json({ error: "Already in use." }, 409);
    }
    throw e;
  }

  return c.json({ ok: true, screen_name: requested });
});

// PATCH /api/profile — set city / state / country / role (post-OAuth completion step).
// role:'auditor' is self-service for MVP. Production deployments should gate this
// behind a verification step before granting audit access.
// Note: does NOT touch screen_name; that has its own endpoint.
profile.patch("/", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    city?: string | null;
    state_or_region?: string | null;
    country?: string | null;
    role?: string | null;
  }>();

  const country = body.country?.trim().toUpperCase().slice(0, 2) || null;
  const state = body.state_or_region?.trim().slice(0, 64) || null;
  const city = body.city?.trim().slice(0, 80) || null;

  if (country !== null && !/^[A-Z]{2}$/.test(country)) {
    return c.json({ error: "country must be a 2-letter ISO code" }, 400);
  }

  // Only 'auditor' is self-grantable. 'admin' requires direct DB access.
  const wantsAuditor = body.role === "auditor";

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE "user" SET city = ?, state_or_region = ?, country = ?, updatedAt = datetime('now') WHERE id = ?`
    ).bind(city, state, country, user.id),
  ];
  if (wantsAuditor) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE "user" SET role = 'auditor' WHERE id = ? AND role = 'user'`
      ).bind(user.id)
    );
  }
  await c.env.DB.batch(stmts);

  return c.json({ ok: true });
});

// POST /api/profile/accept-terms — record ToS acceptance.
profile.post("/accept-terms", requireAuth, async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare(
    `UPDATE "user" SET terms_accepted_at = datetime('now') WHERE id = ?`
  )
    .bind(user.id)
    .run();
  return c.json({ ok: true });
});
