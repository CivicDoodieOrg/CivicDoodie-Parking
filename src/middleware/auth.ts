import { createMiddleware } from "hono/factory";
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

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const auth = createAuth(c.env.DB, c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userRow = await c.env.DB.prepare('SELECT status FROM "user" WHERE id = ?')
    .bind(session.user.id)
    .first<{ status: string }>();
  if (userRow?.status === "banned" || userRow?.status === "suspended") {
    return c.json({ error: "Account suspended" }, 403);
  }

  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
