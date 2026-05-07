import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

export type AuthEnv = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FACEBOOK_CLIENT_ID: string;
  FACEBOOK_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

export function createAuth(d1: D1Database, env: AuthEnv) {
  const db = new Kysely({ dialect: new D1Dialect({ database: d1 }) });

  return betterAuth({
    database: {
      db,
      type: "sqlite",
    },
    advanced: {
      defaultCookieAttributes: {
        secure: env.BETTER_AUTH_URL.startsWith("https"),
      },
    },
    trustedOrigins: [
      "http://localhost:5173",
      "http://localhost:8787",
      "https://parking.civicdoodie.org",
      "https://parking-staging.civicdoodie.org",
    ],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      facebook: {
        clientId: env.FACEBOOK_CLIENT_ID,
        clientSecret: env.FACEBOOK_CLIENT_SECRET,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "facebook"],
      },
    },
    plugins: [bearer()],
    // Note: screen_name is intentionally NOT auto-set here. New users have
    // screen_name = NULL after first sign-in and must pick one via the
    // onboarding flow (POST /api/profile/screen-name). Once set, it's
    // immutable — see /api/profile/screen-name handler for enforcement.
  });
}

export type Auth = ReturnType<typeof createAuth>;
