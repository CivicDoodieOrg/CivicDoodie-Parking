import { Hono } from "hono";

type Env = {
  Bindings: {
    DB: D1Database;
  };
};

export interface TownRow {
  id: string;
  slug: string;
  name: string;
  state_or_region: string | null;
  country: string;
  lat: number;
  lng: number;
}

export const towns = new Hono<Env>();

// GET /api/towns — list, ordered by name. Optional ?q= filters by name prefix
// (case-insensitive). Public; no auth required.
towns.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200", 10) || 200, 500);

  let rows;
  if (q) {
    const pattern = q.replace(/[%_]/g, (m) => "\\" + m) + "%";
    rows = await c.env.DB.prepare(
      `SELECT id, slug, name, state_or_region, country, lat, lng
       FROM town
       WHERE name LIKE ? COLLATE NOCASE OR slug LIKE ? COLLATE NOCASE
       ORDER BY name COLLATE NOCASE
       LIMIT ?`
    )
      .bind(pattern, pattern, limit)
      .all<TownRow>();
  } else {
    rows = await c.env.DB.prepare(
      `SELECT id, slug, name, state_or_region, country, lat, lng
       FROM town
       ORDER BY name COLLATE NOCASE
       LIMIT ?`
    )
      .bind(limit)
      .all<TownRow>();
  }

  return c.json({ towns: rows.results ?? [] });
});

// GET /api/towns/:slug — single town. Slug-only lookup so URLs are stable
// even if we re-key with UUIDs later.
towns.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = await c.env.DB.prepare(
    `SELECT id, slug, name, state_or_region, country, lat, lng
     FROM town
     WHERE slug = ?`
  )
    .bind(slug)
    .first<TownRow>();

  if (!row) return c.json({ error: "Town not found" }, 404);
  return c.json({ town: row });
});
