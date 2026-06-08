import { Hono } from "hono";
import type { AuthEnv } from "../auth";

type Env = { Bindings: AuthEnv & { DB: D1Database } };

export const authDev = new Hono<Env>();

// GET /api/auth-dev/reset-token?email=... — DEV ONLY.
// Returns the most recent reset token for an email so the UI can show the
// "reset code" without email. Hard-gated to localhost; 404 anywhere else.
authDev.get("/reset-token", async (c) => {
  if (!c.env.BETTER_AUTH_URL.includes("localhost")) {
    return c.json({ error: "Not found" }, 404);
  }
  const email = c.req.query("email") ?? "";
  if (!email) return c.json({ token: null });
  const row = await c.env.DB.prepare(
    `SELECT token FROM dev_password_reset
      WHERE email = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  )
    .bind(email)
    .first<{ token: string }>();
  return c.json({ token: row?.token ?? null });
});
