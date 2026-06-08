# Password Reset (dev) + Community Message Anti-Spam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-reset flow (built on better-auth, with the reset code surfaced on-screen in dev since there's no email service) and Light anti-spam limits on community messages.

**Architecture:** Two independent subsystems. (A) Reset: configure better-auth's `sendResetPassword` to persist the token to a `dev_password_reset` table; a localhost-only endpoint returns the latest token; the mockup drives `request-password-reset` → show code → `reset-password`. (B) Anti-spam: a server-side cooldown + duplicate check in the existing message POST handler.

**Tech Stack:** Cloudflare Workers, Hono, D1, better-auth 1.6.9, vanilla JS in the HTML mockup.

**Testing reality:** No D1/Workers test harness in this repo, so routes + reset flow are verified with curl/manual steps (consistent with the rest of the codebase). Pure logic gets a vitest unit test where it's cleanly extractable.

---

## Files Changed

| File | Action | Responsibility |
|------|--------|----------------|
| `src/routes/community.ts` | **Modify** | Light anti-spam (cooldown + no-duplicate) in POST |
| `migrations/0013_dev_password_reset.sql` | **Create** | `dev_password_reset` table |
| `src/auth.ts` | **Modify** | `sendResetPassword` + `resetPasswordTokenExpiresIn` |
| `src/routes/auth-dev.ts` | **Create** | `GET /api/auth-dev/reset-token` (localhost-only) |
| `src/index.ts` | **Modify** | Mount `/api/auth-dev` |
| `mockups/civicdoodies.html` | **Modify** | "Forgot password?" link + reset modal + JS |

---

# Part B — Community message anti-spam (do first; independent)

## Task 1: Light anti-spam in the message POST handler

**Files:**
- Modify: `src/routes/community.ts`

- [ ] **Step 1: Add the cooldown + duplicate check after censoring**

In `src/routes/community.ts`, find this block in the `POST /messages` handler:
```ts
  const { body, flagged } = censor(text);

  const urow = await c.env.DB.prepare(
```
Insert the anti-spam check **between** the `censor(...)` line and the `const urow = ...` line, so it reads:
```ts
  const { body, flagged } = censor(text);

  // Light anti-spam: 3s cooldown + block an exact repeat of the user's last message.
  const last = await c.env.DB.prepare(
    `SELECT body, created_at FROM community_message
      WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
  )
    .bind(user.id)
    .first<{ body: string; created_at: string }>();
  if (last) {
    const lastMs = Date.parse(last.created_at.replace(" ", "T") + "Z");
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < 3000) {
      return c.json(
        { error: "You're posting too fast — wait a few seconds." },
        429
      );
    }
    if (last.body === body) {
      return c.json({ error: "That's the same as your last message." }, 429);
    }
  }

  const urow = await c.env.DB.prepare(
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Verify with curl (Worker running)**

Get a session, then post twice quickly and check the second is throttled:
```bash
TS=$(date +%s)
curl -s -c /tmp/sp.txt -o /dev/null -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/auth/sign-up/email \
  -d '{"name":"sp_'"$TS"'","email":"sp-'"$TS"'@example.com","password":"testpass1234","username":"sp_'"$TS"'"}'
echo -n "first post:  "; curl -s -b /tmp/sp.txt -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/community/messages -d '{"body":"hello one"}' -o /dev/null -w "%{http_code}\n"
echo -n "rapid post:  "; curl -s -b /tmp/sp.txt -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/community/messages -d '{"body":"hello two"}' -w "%{http_code}\n"
```
Expected: first `201`; rapid (`< 3s` later) prints the cooldown error and `429`.

Then wait and test the duplicate guard:
```bash
sleep 4
echo -n "after wait:  "; curl -s -b /tmp/sp.txt -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/community/messages -d '{"body":"hello two"}' -o /dev/null -w "%{http_code}\n"
sleep 4
echo -n "duplicate:   "; curl -s -b /tmp/sp.txt -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/community/messages -d '{"body":"hello two"}' -w "%{http_code}\n"
```
Expected: "after wait" `201` (different body, cooldown passed); "duplicate" prints the duplicate error and `429`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/community.ts
git commit -m "feat(community): light anti-spam (3s cooldown + no exact repeat)"
```

---

# Part A — Password reset (dev delivery)

## Task 2: Migration — `dev_password_reset`

**Files:**
- Create: `migrations/0013_dev_password_reset.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 0013_dev_password_reset.sql
-- DEV ONLY: stores password-reset tokens so a localhost endpoint can show the
-- "reset code" on screen (the app has no email service yet). In production,
-- sendResetPassword emails the token instead and the dev endpoint is disabled.
CREATE TABLE IF NOT EXISTS dev_password_reset (
  email      TEXT NOT NULL,
  token      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_password_reset_email ON dev_password_reset(email, created_at);
```

- [ ] **Step 2: Apply locally**

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --file migrations/0013_dev_password_reset.sql
```
Expected: executed with no error.

- [ ] **Step 3: Commit**

```bash
git add migrations/0013_dev_password_reset.sql
git commit -m "feat(db): add dev_password_reset table (dev reset-code delivery)"
```

---

## Task 3: `auth.ts` — enable reset + persist token

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Add `resetPasswordTokenExpiresIn` + `sendResetPassword`**

In `src/auth.ts`, replace the existing `emailAndPassword` block:
```ts
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
```
with:
```ts
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 3600, // 1 hour
      // No email service yet. Persist the reset token so the localhost-only
      // /api/auth-dev/reset-token endpoint can surface it on screen. In
      // production, replace this with a real email send (and the dev endpoint
      // returns 404). `d1` is the raw D1Database from createAuth's closure.
      sendResetPassword: async ({ user, token }) => {
        await d1
          .prepare(
            `INSERT INTO dev_password_reset (email, token) VALUES (?, ?)`
          )
          .bind(user.email, token)
          .run();
      },
    },
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean. (If `sendResetPassword`'s argument type complains, the callback signature is `({ user, token, url }, request?)`; only `user` and `token` are used here.)

- [ ] **Step 3: Commit**

```bash
git add src/auth.ts
git commit -m "feat(auth): enable password reset; persist token for dev delivery"
```

---

## Task 4: Dev endpoint — `GET /api/auth-dev/reset-token`

**Files:**
- Create: `src/routes/auth-dev.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create `src/routes/auth-dev.ts`**

```ts
import { Hono } from "hono";
import type { AuthEnv } from "../auth";

type Env = { Bindings: AuthEnv & { DB: D1Database } };

export const authDev = new Hono<Env>();

// GET /api/auth-dev/reset-token?email=... — DEV ONLY.
// Returns the most recent reset token for an email so the UI can show the
// "reset code" without email. Hard-gated to localhost; 404 anywhere else.
authDev.get("/reset-token", async (c) => {
  if (!c.env.BETTER_AUTH_URL.includes("localhost")) {
    return c.json({ error: "Not found" }, 404);
  }
  const email = c.req.query("email") ?? "";
  if (!email) return c.json({ token: null });
  const row = await c.env.DB.prepare(
    `SELECT token FROM dev_password_reset
      WHERE email = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  )
    .bind(email)
    .first<{ token: string }>();
  return c.json({ token: row?.token ?? null });
});
```

- [ ] **Step 2: Mount it in `src/index.ts`**

Add the import next to the other route imports:
```ts
import { authDev } from "./routes/auth-dev";
```
Add to the `routes` chain (after `.route("/api/community", community)`):
```ts
  .route("/api/community", community)
  .route("/api/auth-dev", authDev);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Verify end-to-end with curl (Worker running)**

Create a password user, request a reset, fetch the dev token, reset, then sign in with the new password:
```bash
TS=$(date +%s); EMAIL="reset-$TS@example.com"
curl -s -o /dev/null -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/auth/sign-up/email \
  -d '{"name":"rst_'"$TS"'","email":"'"$EMAIL"'","password":"oldpass1234","username":"rst_'"$TS"'"}'
curl -s -o /dev/null -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/auth/request-password-reset \
  -d '{"email":"'"$EMAIL"'","redirectTo":"http://localhost:5050/"}'
TOKEN=$(curl -s "http://localhost:8787/api/auth-dev/reset-token?email=$EMAIL" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'] or '')")
echo "dev token: ${TOKEN:0:12}..."
curl -s -o /dev/null -w "reset: %{http_code}\n" -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/auth/reset-password \
  -d '{"token":"'"$TOKEN"'","newPassword":"newpass1234"}'
curl -s -o /dev/null -w "signin new pw: %{http_code}\n" -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/auth/sign-in/email \
  -d '{"email":"'"$EMAIL"'","password":"newpass1234"}'
```
Expected: a non-empty dev token; `reset: 200`; `signin new pw: 200`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth-dev.ts src/index.ts
git commit -m "feat(auth): localhost-only dev endpoint to read the reset token"
```

---

## Task 5: Mockup — "Forgot password?" link + reset modal

**Files:**
- Modify: `mockups/civicdoodies.html`

- [ ] **Step 1: Add a "Forgot password?" link to the sign-in modal**

In the sign-in modal, find the password input + remember-me block:
```html
    <input id="signin-password" class="field-input" type="password" placeholder="Password" autocomplete="current-password" />
    <label class="signin-remember" id="signin-remember-wrap">
```
Insert a forgot link between them:
```html
    <input id="signin-password" class="field-input" type="password" placeholder="Password" autocomplete="current-password" />
    <p class="signin-forgot" id="signin-forgot"><a onclick="openReset()">Forgot password?</a></p>
    <label class="signin-remember" id="signin-remember-wrap">
```

- [ ] **Step 2: Add the reset modal markup**

Immediately AFTER the closing `</div>` of `#signin-modal` (the line `</div>` that ends `<div id="signin-modal" ...>`), add:
```html
<div id="reset-modal" class="signin-backdrop" style="display:none;" onclick="onResetBackdrop(event)">
  <div class="signin-card">
    <button class="signin-close" onclick="closeReset()" aria-label="Close">&times;</button>
    <h2 class="signin-title">Reset password</h2>
    <div class="signin-error" id="reset-error"></div>
    <label class="field-label" for="reset-email">Email</label>
    <input id="reset-email" class="field-input" type="email" placeholder="you@example.com" autocomplete="email" />
    <button class="btn btn-primary btn-block" id="reset-getcode" onclick="resetGetCode()">Get reset code</button>
    <div id="reset-step2" style="display:none;">
      <p class="email-hint" id="reset-codenote" style="display:block;"></p>
      <label class="field-label" for="reset-newpw">New password <span style="color:var(--signal-dark);">*</span></label>
      <input id="reset-newpw" class="field-input" type="password" placeholder="At least 8 characters" autocomplete="new-password" />
      <button class="btn btn-primary btn-block" id="reset-submit" onclick="resetSubmit()">Reset password</button>
    </div>
    <p class="signin-toggle">Remembered it? <a onclick="closeReset(); openSignIn('signin')">Back to sign in</a></p>
  </div>
</div>
```

- [ ] **Step 3: Add CSS for the forgot link**

Near the other `.signin-*` rules in `<style>`:
```css
  .signin-forgot { text-align:right; font-size:12px; margin:-8px 0 14px; }
  .signin-forgot a { color:var(--signal-dark); font-weight:500; cursor:pointer; }
```

- [ ] **Step 4: Toggle the forgot link by mode in `applySignInMode()`**

Find the line that toggles the remember row:
```js
  document.getElementById('signin-remember-wrap').style.display = isCreate ? 'none' : 'flex';
```
Add right after it:
```js
  document.getElementById('signin-forgot').style.display = isCreate ? 'none' : 'block';
```

- [ ] **Step 5: Add the reset-flow JS**

Insert after the `submitSignIn()` function (before the `/* ---------- auth state ---------- */` comment):
```js
/* ---------- password reset (dev delivery) ---------- */
var resetToken = null;

function openReset(){
  document.getElementById('reset-email').value = (document.getElementById('signin-email').value || '').trim();
  document.getElementById('reset-newpw').value = '';
  document.getElementById('reset-step2').style.display = 'none';
  document.getElementById('reset-getcode').disabled = false;
  document.getElementById('reset-getcode').textContent = 'Get reset code';
  resetToken = null;
  showResetError('');
  closeSignIn();
  document.getElementById('reset-modal').style.display = 'flex';
}

function closeReset(){ document.getElementById('reset-modal').style.display = 'none'; }
function onResetBackdrop(e){ if(e.target === document.getElementById('reset-modal')) closeReset(); }

function showResetError(msg){
  var el = document.getElementById('reset-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// Step 1: ask better-auth to create a reset token, then read it from the
// dev endpoint and show it on screen.
function resetGetCode(){
  var email = document.getElementById('reset-email').value.trim();
  if(!email){ showResetError('Enter your email.'); return; }
  showResetError('');
  var btn = document.getElementById('reset-getcode');
  btn.disabled = true; btn.textContent = 'Sending...';
  authRequest('/request-password-reset', { email: email, redirectTo: window.location.href })
    .catch(function(){ /* better-auth returns ok regardless (anti-enumeration) */ })
    .then(function(){
      return fetch(API_BASE + '/api/auth-dev/reset-token?email=' + encodeURIComponent(email), { credentials: 'include' })
        .then(function(r){ return r.ok ? r.json() : { token: null }; });
    })
    .then(function(d){
      btn.disabled = false; btn.textContent = 'Get reset code';
      if(d && d.token){
        resetToken = d.token;
        document.getElementById('reset-codenote').textContent = 'Dev mode — your reset code: ' + d.token;
        document.getElementById('reset-step2').style.display = 'block';
      } else {
        showResetError('No code found — that email may not exist or uses Google sign-in.');
      }
    })
    .catch(function(err){
      btn.disabled = false; btn.textContent = 'Get reset code';
      showResetError(err.message || 'Something went wrong.');
    });
}

// Step 2: set the new password with the token.
function resetSubmit(){
  var pw = document.getElementById('reset-newpw').value;
  if(pw.length < 8){ showResetError('Password must be at least 8 characters.'); return; }
  if(!resetToken){ showResetError('Get a reset code first.'); return; }
  showResetError('');
  var btn = document.getElementById('reset-submit');
  btn.disabled = true; btn.textContent = 'Resetting...';
  authRequest('/reset-password', { token: resetToken, newPassword: pw })
    .then(function(){
      closeReset();
      openSignIn('signin');
      alert('Password updated — sign in with your new password.');
    })
    .catch(function(err){
      btn.disabled = false; btn.textContent = 'Reset password';
      showResetError(err.message || 'Reset failed — the code may be expired. Request a new one.');
    });
}
```

- [ ] **Step 6: Verify no curly quotes + JS parses**

```bash
python3 -c "
b=open('mockups/civicdoodies.html','rb').read()
bad=[m for m in [b'\xe2\x80\x98',b'\xe2\x80\x99',b'\xe2\x80\x9c',b'\xe2\x80\x9d'] if m in b]
print('CURLY QUOTES FOUND' if bad else 'clean: no curly quotes')
"
node --check <(sed -n '/<script>/,/<\/script>/p' mockups/civicdoodies.html | sed '1d;$d') 2>&1 | head -3 && echo "parse: clean"
```
Expected: `clean: no curly quotes` and `parse: clean`.

- [ ] **Step 7: Commit**

```bash
git add mockups/civicdoodies.html
git commit -m "feat(mockup): forgot-password flow (request code, set new password)"
```

---

## Task 6: End-to-end manual verification

No code — confirms both features in a browser. Worker running; mockup served over http on localhost.

- [ ] **Step 1: Anti-spam** — On the Community tab, send a message, then immediately send another. Expected: the second is rejected with "You're posting too fast." Wait ~4s, send a *new* message (works); send the exact same text again → "That's the same as your last message."

- [ ] **Step 2: Reset happy path** — Create an account with a known email/password. Sign out. Open sign-in → click **"Forgot password?"** → enter that email → **Get reset code** → the dev code appears → enter a new password (≥8) → **Reset password** → "Password updated." Sign in with the **new** password → works.

- [ ] **Step 3: Unknown email** — Forgot password with an email that has no password account → "No code found…" (no crash).

- [ ] **Step 4: Prod gate (sanity)** — Confirm the dev endpoint is localhost-gated:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/api/auth-dev/reset-token?email=x@y.z"
  ```
  Expected `200` locally (BETTER_AUTH_URL is localhost). In a deployed env (non-localhost BETTER_AUTH_URL) it would return `404` — do not expose this endpoint in production.

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Anti-spam: 3s cooldown + no exact repeat, 429, server-side | Task 1 |
| `dev_password_reset` table | Task 2 |
| `sendResetPassword` + 1h expiry, persist token | Task 3 |
| Localhost-only `GET /api/auth-dev/reset-token` | Task 4 |
| Uses better-auth `request-password-reset` + `reset-password` | Task 4 (curl) + Task 5 (UI) |
| "Forgot password?" link + 2-step reset modal | Task 5 |
| Anti-enumeration neutral message | Task 5 (`resetGetCode` else branch) |
| Forgot username skipped | n/a (out of scope) |
| Manual verification of both | Task 6 |

**Placeholder scan:** No TBDs; every code step is complete; curl/manual steps have exact commands + expected output.

**Type/identifier consistency:** `dev_password_reset(email, token, created_at)` columns identical in Task 2 (DDL), Task 3 (INSERT), Task 4 (SELECT). The dev endpoint returns `{ token }` in Task 4 and is consumed as `d.token` in Task 5. `authRequest('/request-password-reset' | '/reset-password', …)` matches better-auth's endpoints. `resetToken` is set in `resetGetCode` and read in `resetSubmit` (Task 5). The anti-spam check uses the existing `body`/`user`/`c.env.DB` already in the handler (Task 1).

**Scope note:** Two independent subsystems in one plan (anti-spam vs reset); each is self-contained and separately committable. Part B (Task 1) ships on its own; Part A (Tasks 2-6) ships on its own.
