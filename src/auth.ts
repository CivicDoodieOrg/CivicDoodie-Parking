import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import { generateSlug, sanitizeScreenName } from "./lib/slug";

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
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const baseScreenName = sanitizeScreenName(user.name || "user");
            let finalScreenName = baseScreenName;
            for (let attempt = 0; attempt < 5; attempt++) {
              const existing = await d1
                .prepare('SELECT 1 FROM "user" WHERE screen_name = ?')
                .bind(finalScreenName)
                .first();
              if (!existing) break;
              finalScreenName = baseScreenName + "-" + generateSlug().slice(0, 4);
            }
            await d1
              .prepare('UPDATE "user" SET screen_name = ? WHERE id = ?')
              .bind(finalScreenName, user.id)
              .run();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
