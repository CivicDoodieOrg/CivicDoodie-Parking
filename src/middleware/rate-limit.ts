import { createMiddleware } from "hono/factory";

type Env = {
  Bindings: Record<string, unknown>;
  Variables: {
    user: { id: string; email: string; name: string; image?: string | null };
    session: { id: string; userId: string; expiresAt: Date };
  };
};

interface WindowEntry {
  count: number;
  resetAt: number;
}

// In-memory sliding-window counters. Per-isolate, reset on cold start.
// At our expected scale this is plenty; if traffic ever justifies a global
// limiter, swap in a KV/D1-backed store behind the same interface.
const counters = new Map<string, WindowEntry>();

let lastEviction = 0;
const EVICTION_INTERVAL = 60_000;

function evictExpired() {
  const now = Date.now();
  if (now - lastEviction < EVICTION_INTERVAL) return;
  lastEviction = now;
  for (const [key, entry] of counters) {
    if (now >= entry.resetAt) counters.delete(key);
  }
}

function checkLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  evictExpired();
  const now = Date.now();
  const entry = counters.get(key);

  if (!entry || now >= entry.resetAt) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

interface RateLimitRule {
  pattern: RegExp;
  method?: string;
  limit: number;
  windowMs: number;
  keyType: "ip" | "user";
}

// First match wins — order specific rules before catch-alls.
const rules: RateLimitRule[] = [
  // Reports — tight, abuse prevention.
  { pattern: /^\/api\/towns\/[^/]+\/doodies\/[^/]+\/report$/,    method: "POST", limit: 5,   windowMs: 3_600_000, keyType: "user" },
  { pattern: /^\/api\/comments\/[^/]+\/report$/,                 method: "POST", limit: 5,   windowMs: 3_600_000, keyType: "user" },
  // Doodie creation — moderate (real reports take time to file).
  { pattern: /^\/api\/towns\/[^/]+\/doodies$/,                   method: "POST", limit: 10,  windowMs: 3_600_000, keyType: "user" },
  // Comments — chatty but bounded.
  { pattern: /^\/api\/towns\/[^/]+\/doodies\/[^/]+\/comments$/,  method: "POST", limit: 30,  windowMs: 60_000,    keyType: "user" },
  // Votes — users may bulk-vote browsing the dashboard.
  { pattern: /^\/api\/towns\/[^/]+\/doodies\/[^/]+\/vote$/,      method: "POST", limit: 60,  windowMs: 60_000,    keyType: "user" },
  { pattern: /^\/api\/comments\/[^/]+\/vote$/,                   method: "POST", limit: 60,  windowMs: 60_000,    keyType: "user" },
  // Screen-name checks — onboarding form may fire several debounced calls.
  { pattern: /^\/api\/profile\/screen-name\/check$/,             method: "GET",  limit: 60,  windowMs: 60_000,    keyType: "ip" },
  // Public reads — generous (covers towns list/detail, doodies list/detail, image fetches).
  { pattern: /^\/api\/towns/,                                    method: "GET",  limit: 240, windowMs: 60_000,    keyType: "ip" },
  // Catch-all for writes (POST/PUT/PATCH/DELETE on /api/*).
  { pattern: /^\/api\//, limit: 30, windowMs: 60_000, keyType: "user" },
];

function findRule(method: string, path: string): RateLimitRule | null {
  for (const rule of rules) {
    if (rule.method && rule.method !== method) continue;
    if (!rule.method && !["POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
    if (rule.pattern.test(path)) return rule;
  }
  return null;
}

export const rateLimit = createMiddleware<Env>(async (c, next) => {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  const rule = findRule(method, path);
  if (!rule) {
    await next();
    return;
  }

  let key: string;
  if (rule.keyType === "ip") {
    key =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for") ||
      "unknown";
  } else {
    const user = c.get("user");
    key =
      user?.id ||
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for") ||
      "unknown";
  }

  const bucketKey = `${rule.pattern.source}:${key}`;
  const { allowed, retryAfter } = checkLimit(bucketKey, rule.limit, rule.windowMs);

  if (!allowed) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "Too many requests" }, 429);
  }

  await next();
});
