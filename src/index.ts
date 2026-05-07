import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FACEBOOK_CLIENT_ID: string;
  FACEBOOK_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
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

export default app;
