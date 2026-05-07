import { createMiddleware } from "hono/factory";

type Env = {
  Bindings: {
    ADMIN_USER_IDS?: string;
  };
  Variables: {
    user: { id: string; email: string; name: string; image?: string | null };
    session: { id: string; userId: string; expiresAt: Date };
  };
};

// Returns 404 (not 403) so admin endpoints don't leak their existence.
// Must be chained after requireAuth — relies on c.get("user").
export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const user = c.get("user");
  const adminIds = (c.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!user || !adminIds.includes(user.id)) {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});
