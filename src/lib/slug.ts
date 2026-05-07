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
  "privacy", "terms", "about", "profile", "onboarding",
  "report", "dashboard", "settings", "explore",
]);

// sanitizeScreenName is best-effort cleanup that always returns SOMETHING usable.
// Used to compute a default suggestion from an OAuth display name on first sign-in.
export function sanitizeScreenName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  if (!base || base.length < 3 || RESERVED_SCREEN_NAMES.has(base)) {
    return (base || "user") + "-" + generateSlug().slice(0, 4);
  }
  return base;
}

// validateScreenName returns an error message if the user-typed input doesn't
// meet the rules — stricter than sanitize because a user picking their public
// handle should know exactly what they're getting (no silent corrections).
//
// Mixed case is allowed; the user's case preference is preserved on save.
// Uniqueness, reserved-word matching, and URL routing are all case-insensitive.
export function validateScreenName(name: string): string | null {
  if (typeof name !== "string") return "Screen name is required.";
  if (name.length === 0) return "Screen name is required.";
  if (name.length < 3) return "Screen name must be at least 3 characters.";
  if (name.length > 30) return "Screen name must be 30 characters or fewer.";
  if (!/^[A-Za-z0-9-]+$/.test(name)) {
    return "Use only letters, digits, and hyphens.";
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return "Cannot start or end with a hyphen.";
  }
  if (name.includes("--")) return "Cannot contain consecutive hyphens.";
  if (RESERVED_SCREEN_NAMES.has(name.toLowerCase())) {
    return "That name is reserved.";
  }
  return null;
}
