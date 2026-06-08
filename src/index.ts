import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { createAuth, type AuthEnv } from "./auth";
import { rateLimit } from "./middleware/rate-limit";
import { profile } from "./routes/profile";
import { towns } from "./routes/towns";
import { doodies, checks } from "./routes/doodies";
import { doodieComments, comments } from "./routes/comments";
import { dashboard } from "./routes/dashboard";
import { admin } from "./routes/admin";
import * as openapiRoutes from "./openapi-routes";

type Bindings = AuthEnv & {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_USER_IDS: string;
};

type Variables = {
  user: { id: string; email: string; name: string; image?: string | null };
  session: { id: string; userId: string; expiresAt: Date };
};

const app = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Session token from Google or Facebook OAuth",
});

// CORS headers for allowed cross-origin API calls. Local dev allows localhost
// ports; deployed preview hosts are configured through AUTH_TRUSTED_ORIGINS.
// Same-origin production requests do not need these headers. Shared by the
// /api/* middleware and the /api/auth/* catch-all so better-auth's own
// Response gets them too.
function corsHeaders(origin: string, env: AuthEnv): Record<string, string> | null {
  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    origin === "null";
  const trustedOrigins = [
    "https://parking.civicdoodie.org",
    "https://parking-staging.civicdoodie.org",
    ...(env.AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const isTrusted = trustedOrigins.some((trusted) =>
    trusted.includes("*")
      ? new RegExp(
          "^" +
            trusted
              .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, "[^.]+") +
            "$"
        ).test(origin)
      : trusted === origin
  );

  if (!isLocal && !isTrusted) return null;
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

app.use("/api/*", async (c, next) => {
  const cors = corsHeaders(c.req.header("Origin") ?? "", c.env);
  if (cors) for (const [k, v] of Object.entries(cors)) c.header(k, v);
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

// Rate limiting on all /api/* routes — applied before any route logic.
app.use("/api/*", rateLimit);

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// GET /api/map — all approved, located doodies across every town.
// Used by the global mismatch map in the mockup / future SPA map view.
// Includes town_slug so the client can deep-link to the right town context.
app.get("/api/map", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.slug, t.slug AS town_slug, t.name AS town_name, d.type,
            d.lat, d.lng, d.report_count, d.fix_state,
            d.upvotes_count, d.downvotes_count
     FROM doodie d
     JOIN town t ON t.id = d.town_id
     WHERE d.moderation_status = 'approved'
       AND d.lat IS NOT NULL AND d.lng IS NOT NULL`
  ).all<{
    id: string; slug: string; town_slug: string; town_name: string; type: string;
    lat: number; lng: number; report_count: number; fix_state: string;
    upvotes_count: number; downvotes_count: number;
  }>();

  return c.json({ pins: rows.results ?? [] });
});

// GET /api/stats — public aggregate counts for the landing page.
app.get("/api/stats", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       COUNT(*)                    AS zones_count,
       COUNT(DISTINCT town_id)     AS towns_count,
       COALESCE(SUM(report_count), 0) AS reports_total
     FROM doodie
     WHERE moderation_status = 'approved'`
  ).first<{ zones_count: number; towns_count: number; reports_total: number }>();

  return c.json({
    zones_count:   row?.zones_count   ?? 0,
    towns_count:   row?.towns_count   ?? 0,
    reports_total: row?.reports_total ?? 0,
  });
});

const routes = app
  .route("/api/profile", profile)
  .route("/api/towns", towns)
  .route("/api/towns/:townSlug/doodies", doodies)
  .route("/api/towns/:townSlug/checks", checks)
  .route("/api/towns/:townSlug/doodies/:doodieSlug/comments", doodieComments)
  .route("/api/towns/:townSlug/dashboard", dashboard)
  .route("/api/comments", comments)
  .route("/api/admin", admin);

app.all("/api/auth/*", async (c) => {
  const auth = createAuth(c.env.DB, c.env);
  const res = await auth.handler(c.req.raw);
  // better-auth returns its own Response, bypassing the /api/* CORS middleware
  // (which sets headers on c.res before next()). Re-apply them to the response
  // body so cross-origin dev requests (mockup on :3001/:5173) aren't blocked.
  const cors = corsHeaders(c.req.header("Origin") ?? "", c.env);
  if (!cors) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
});

// Register every exported route declaration with the OpenAPI registry.
// These are documentation-only — actual handlers live in src/routes/*.
for (const route of Object.values(openapiRoutes)) {
  app.openAPIRegistry.registerPath(route);
}

app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "CivicDoodie Parking API",
    version: "0.0.1",
    description:
      "API for reporting and tracking parking-meter, garage, and enforcement issues by municipality.",
  },
  servers: [
    { url: "https://parking.civicdoodie.org", description: "Production" },
    { url: "https://parking-staging.civicdoodie.org", description: "Staging" },
  ],
});

app.get(
  "/api/docs",
  Scalar({
    url: "/api/openapi.json",
    pageTitle: "CivicDoodie Parking API",
  })
);

// Unmatched /api/* paths return JSON 404. Everything else is delegated to the
// assets binding, which serves a static file or — per wrangler.json's
// not_found_handling: spa — falls back to /index.html so the Svelte router
// can take over.
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not Found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
export type AppType = typeof routes;
