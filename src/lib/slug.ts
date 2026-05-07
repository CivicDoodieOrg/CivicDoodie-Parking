export function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  if (!base) {
    return generateSlug();
  }
  return base;
}

const RESERVED_SCREEN_NAMES = new Set([
  "api", "auth", "admin", "u", "t", "d",
  "town", "towns", "doodie", "doodies",
  "login", "signup", "logout", "signin", "signout",
  "privacy", "terms", "about", "profile",
  "report", "dashboard", "settings", "explore",
]);

export function sanitizeScreenName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 39);
  if (!base || base.length < 2 || RESERVED_SCREEN_NAMES.has(base)) {
    return (base || "user") + "-" + generateSlug().slice(0, 4);
  }
  return base;
}
