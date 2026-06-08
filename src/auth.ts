import { betterAuth } from "better-auth";
import { bearer, username } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

type AuthEmailAddress = string | { name: string; email: string };

type AuthEmailBinding = {
  send: (message: {
    from: AuthEmailAddress;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }) => Promise<{ messageId: string }>;
};

type AuthExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

export type AuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FACEBOOK_CLIENT_ID?: string;
  FACEBOOK_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  EMAIL?: AuthEmailBinding;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_FROM_NAME?: string;
  AUTH_REQUIRE_EMAIL_VERIFICATION?: string;
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

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authEmailFrom(env: AuthEnv): AuthEmailAddress | null {
  if (!env.AUTH_EMAIL_FROM) return null;
  const name = env.AUTH_EMAIL_FROM_NAME?.trim() || "CivicDoodie Parking";
  return { name, email: env.AUTH_EMAIL_FROM };
}

function queueAuthWork(
  executionCtx: AuthExecutionContext | undefined,
  work: Promise<unknown>
) {
  const logged = work.catch((err: unknown) => {
    console.error("auth email task failed", err);
  });
  if (executionCtx) {
    executionCtx.waitUntil(logged);
  } else {
    void logged;
  }
}

function sendAuthEmail(
  env: AuthEnv,
  params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }
) {
  const from = authEmailFrom(env);
  if (!env.EMAIL || !from) {
    return Promise.reject(
      new Error("AUTH_EMAIL_FROM and EMAIL binding are required to send auth email")
    );
  }
  return env.EMAIL.send({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}

function isLocalAuthUrl(env: AuthEnv): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.BETTER_AUTH_URL);
}

export function createAuth(
  d1: D1Database,
  env: AuthEnv,
  executionCtx?: AuthExecutionContext
) {
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
    emailVerification: {
      sendOnSignUp: Boolean(env.EMAIL && env.AUTH_EMAIL_FROM),
      sendOnSignIn: env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true",
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const safeUrl = htmlEscape(url);
        queueAuthWork(
          executionCtx,
          sendAuthEmail(env, {
            to: user.email,
            subject: "Verify your CivicDoodie Parking email",
            text: [
              "Verify your CivicDoodie Parking email address:",
              "",
              url,
              "",
              "This link expires in 1 hour.",
            ].join("\n"),
            html: [
              "<p>Verify your CivicDoodie Parking email address.</p>",
              `<p><a href="${safeUrl}">Verify email</a></p>`,
              "<p>This link expires in 1 hour.</p>",
            ].join(""),
          })
        );
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true",
      resetPasswordTokenExpiresIn: 3600, // 1 hour
      sendResetPassword: async ({ user, url, token }) => {
        if (env.EMAIL && env.AUTH_EMAIL_FROM) {
          const safeUrl = htmlEscape(url);
          queueAuthWork(
            executionCtx,
            sendAuthEmail(env, {
              to: user.email,
              subject: "Reset your CivicDoodie Parking password",
              text: [
                "Reset your CivicDoodie Parking password:",
                "",
                url,
                "",
                "This link expires in 1 hour.",
              ].join("\n"),
              html: [
                "<p>Reset your CivicDoodie Parking password.</p>",
                `<p><a href="${safeUrl}">Reset password</a></p>`,
                "<p>This link expires in 1 hour.</p>",
              ].join(""),
            })
          );
          return;
        }

        if (isLocalAuthUrl(env)) {
          await d1
            .prepare(
              `INSERT INTO dev_password_reset (email, token) VALUES (?, ?)`
            )
            .bind(user.email, token)
            .run();
          return;
        }

        throw new Error("Auth email is not configured");
      },
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
