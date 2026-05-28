// Dashboard helper endpoints. Recent + top tabs are served by the existing
// GET /api/towns/:townSlug/doodies?sort=recent|top — this file only adds
// what those don't cover: a thin map-view payload for client-side
// clustering (MapLibre + supercluster).

import { Hono } from "hono";

type Env = {
  Bindings: {
    DB: D1Database;
  };
};

export const dashboard = new Hono<Env>();

// GET /api/towns/:townSlug/dashboard/map
// Returns approved, located doodies as a thin payload suitable for pin
// rendering and supercluster clustering. Doodies without lat/lng are
// excluded (no useful map representation).
dashboard.get("/map", async (c) => {
  const townSlug = c.req.param("townSlug")!;
  const town = await c.env.DB.prepare(`SELECT id FROM town WHERE slug = ?`)
    .bind(townSlug)
    .first<{ id: string }>();
  if (!town) return c.json({ error: "Not found" }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT id, slug, type, lat, lng, upvotes_count, downvotes_count,
            report_count, fix_state
     FROM doodie
     WHERE town_id = ?
       AND moderation_status = 'approved'
       AND lat IS NOT NULL AND lng IS NOT NULL`
  )
    .bind(town.id)
    .all<{
      id: string;
      slug: string;
      type: "enforcement" | "meter" | "garage";
      lat: number;
      lng: number;
      upvotes_count: number;
      downvotes_count: number;
      report_count: number;
      fix_state: "unresolved" | "investigating" | "resolved_unconfirmed";
    }>();

  return c.json({ pins: rows.results ?? [] });
});
