import { betterAuth } from "better-auth";
import { bearer, username } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

export type AuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FACEBOOK_CLIENT_ID?: string;
  FACEBOOK_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  // Optional: when set, scopes session cookies to a parent domain
  // (e.g. ".preview.civicdoodie.org") so multiple Workers under that
  // suffix can share a session. Unset = host-only cookie (default).
  AUTH_COOKIE_DOMAIN?: string;
  // Optional: comma-separated list of origins to add to Better Auth's
  // trustedOrigins list (in addition to the static baseline).
  AUTH_TRUSTED_ORIGINS?: string;
};

const STATIC_TRUSTED_ORIGINS = [
  // Local dev: trust any localhost / 127.0.0.1 port so the mockup can be
  // served from whatever static-file port (5050, 5500, 8000, …) without
  // tripping better-auth's CSRF origin check on cookied requests.
  "http://localhost:*",
  "http://127.0.0.1:*",
  "https://parking.civicdoodie.org",
  "https://parking-staging.civicdoodie.org",
];

export function createAuth(d1: D1Database, env: AuthEnv) {
  const db = new Kysely({ dialect: new D1Dialect({ database: d1 }) });

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) {
    socialProviders.facebook = {
      clientId: env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
    };
  }

  const extraOrigins = (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return betterAuth({
    database: {
      db,
      type: "sqlite",
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          input: false,
        },
        // Collected on the email/password sign-up form and persisted to the
        // user row. All optional at the schema level so the Google OAuth
        // sign-up path (which doesn't supply them) keeps working; the form
        // enforces which are required on the client.
        first_name: { type: "string", required: false, input: true },
        last_name: { type: "string", required: false, input: true },
        country: { type: "string", required: false, input: true },
        city: { type: "string", required: false, input: true },
      },
    },
    advanced: {
      defaultCookieAttributes: {
        secure: env.BETTER_AUTH_URL.startsWith("https"),
        ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
      },
    },
    trustedOrigins: [...STATIC_TRUSTED_ORIGINS, ...extraOrigins],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "facebook"],
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      bearer(),
      // Adds a unique login handle + POST /api/auth/sign-in/username.
      // Handles are 3-30 chars, [a-zA-Z0-9_.], stored lowercased.
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
