import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { createAuth, type AuthEnv } from "./auth";
import { profile } from "./routes/profile";

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

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/profile", profile);

app.all("/api/auth/*", async (c) => {
  const auth = createAuth(c.env.DB, c.env);
  return auth.handler(c.req.raw);
});

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
