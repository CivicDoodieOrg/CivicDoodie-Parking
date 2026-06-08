# Password Reset (dev delivery) + Community Message Anti-Spam — Design

**Date:** 2026-06-08
**Files touched:** `migrations/0013_dev_password_reset.sql`, `src/auth.ts`, `src/routes/auth-dev.ts`, `src/index.ts`, `src/routes/community.ts`, `mockups/civicdoodies.html`

Two small, independent additions bundled because they were requested together.

---

## Part A — Password reset (dev delivery)

### Goal

Let a user who forgot their password reset it. The app has **no email service**, so in dev the reset **token is surfaced on-screen** instead of emailed. Everything else uses better-auth's real reset machinery (genuine single-use, expiring token), so swapping in a real email provider later is a one-function change.

Confirmed available in better-auth 1.6.9: the `sendResetPassword` option and the `/api/auth/request-password-reset` + `/api/auth/reset-password` endpoints (configuring `sendResetPassword` is what enables them).

### Backend

1. **`src/auth.ts`** — add to the `emailAndPassword` config:
   ```ts
   emailAndPassword: {
     enabled: true,
     requireEmailVerification: false,
     resetPasswordTokenExpiresIn: 3600, // 1 hour
     sendResetPassword: async ({ user, token }) => {
       // No email service yet. Persist the token so the dev "reset code"
       // endpoint can surface it. In production, replace this body with a
       // real email send (and disable the dev endpoint below).
       await db.insertInto("dev_password_reset")
         .values({ email: user.email, token, created_at: <now> })
         .execute();  // (exact call uses the same Kysely `db` already in auth.ts)
     },
   }
   ```
   (Implementation note: `auth.ts` already has a Kysely `db`. The insert can also be done with a raw `db` statement; the plan will use whichever is simplest and type-checks.)

2. **Migration `0013_dev_password_reset.sql`** (next free number after `0012`):
   ```sql
   CREATE TABLE IF NOT EXISTS dev_password_reset (
     email      TEXT NOT NULL,
     token      TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS idx_dev_password_reset_email ON dev_password_reset(email, created_at);
   ```

3. **Dev-only endpoint — `src/routes/auth-dev.ts`**, mounted at `/api/auth-dev`:
   - `GET /api/auth-dev/reset-token?email=…` → returns `{ token }` for the most recent reset request for that email, or `{ token: null }`.
   - **Localhost-gated:** if `env.BETTER_AUTH_URL` does not contain `localhost`, return `404`. This endpoint exposes reset tokens and must never run in production; the real email path replaces it.

### Frontend (mockup)

A **"Forgot password?"** link on the sign-in modal opens a reset mode with two steps (reusing the modal styles):

1. **Request:** enter email → **"Get reset code"** → `POST /api/auth/request-password-reset` `{ email, redirectTo: window.location.href }` → then `GET /api/auth-dev/reset-token?email=…` → show the returned code in a "dev mode" note. (Anti-enumeration: if no token comes back, show a neutral "If that email exists, a code was created.")
2. **Reset:** enter a **new password** (the code is pre-filled from step 1) → **"Reset password"** → `POST /api/auth/reset-password` `{ token, newPassword }` → on success, return to sign-in mode with a "Password updated — sign in" note.

### Notes / security

- The token is better-auth's genuine token (single-use, 1-hour expiry). Only **delivery** is faked, and only on localhost.
- The dev token endpoint is the one risky surface; it is hard-gated to localhost and clearly documented as dev-only.
- **Forgot username:** skipped — sign-in already accepts email *or* username.

---

## Part B — Community message anti-spam (Light)

### Goal

Stop rapid-fire and copy-paste spam in the community board without annoying normal posting. Enforced **server-side** in the existing `POST /api/community/messages` handler (no new table — queries `community_message` by `user_id`).

### Rules (Light)

Applied **after** auth + length validation + censoring, **before** insert:

1. **Cooldown:** if the user's most recent message was posted **< 3 seconds** ago → `429 { error: "You're posting too fast — wait a few seconds." }`.
2. **No exact repeat:** if the (censored) body equals the user's **last** message body → `429 { error: "That's the same as your last message." }`.

Implementation sketch (in `src/routes/community.ts`, after computing the censored `body`):
```ts
const last = await c.env.DB.prepare(
  `SELECT body, created_at FROM community_message
    WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
).bind(user.id).first<{ body: string; created_at: string }>();
if (last) {
  const lastMs = Date.parse(last.created_at.replace(" ", "T") + "Z");
  if (!Number.isNaN(lastMs) && Date.now() - lastMs < 3000) {
    return c.json({ error: "You're posting too fast — wait a few seconds." }, 429);
  }
  if (last.body === body) {
    return c.json({ error: "That's the same as your last message." }, 429);
  }
}
```

### Frontend

No new UI needed: the existing `sendMessage()` `.catch` already surfaces the server's `error` string (apiFetch throws it). A `429` shows as "Could not send: You're posting too fast — wait a few seconds." (The plan may upgrade this from an `alert` to an inline note — minor.)

---

## Out of Scope (YAGNI)

Real email delivery, account lockout, per-IP message limits beyond the existing `/api/*` rate-limit middleware, daily caps, CAPTCHA, and forgot-username recovery.

---

## Testing

- **Part A (manual / curl, no email harness):** request a reset for a known email → dev endpoint returns a token → `reset-password` with that token + a new password succeeds → sign in with the new password works; the dev endpoint returns `404` when `BETTER_AUTH_URL` is non-local.
- **Part B:** unit-test the cooldown/duplicate logic if extracted to a pure helper; otherwise curl: two quick POSTs from one session → second returns `429` (cooldown); posting an identical body as the last → `429` (duplicate); a different body after the cooldown → `201`.
