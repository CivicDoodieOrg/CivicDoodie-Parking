# Email + Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/password sign-up and sign-in alongside the existing Google OAuth, with a `role` column (`user` | `auditor`) that gates the Edit column in the auditor table.

**Architecture:** Enable better-auth's `emailAndPassword` plugin on the server and expose `role` through better-auth's `additionalFields` so it rides on the session object (`GET /api/auth/get-session`) and the existing profile endpoint. The **HTML mockup** (`mockups/civicdoodies.html`) is the active frontend: its existing sign-in/create-account modal is wired to better-auth's raw HTTP endpoints via `fetch`, a `currentUser` state object is populated from the session on load, the header reflects auth state, and the auditor table's Edit column is rendered only for auditors. The app stays publicly accessible — unauthenticated visitors see the full UI minus the Edit column. (The Svelte SPA in `web/` is **not** touched here; that migration comes later.)

**Tech Stack:** better-auth 1.5.x, vanilla JS in a single HTML file, Hono, Cloudflare D1 (SQLite)

---

## Role Strategy: promotion by existing auditor (recommended)

**Do not pre-seed auditors by email.** Emails are mutable — a person changes their Google account or email address and the pre-seeded row is orphaned. Instead:

1. All self-created accounts default to `role = 'user'`.
2. Any existing auditor can promote another user to `auditor` via `POST /api/admin/users/:id/promote-auditor` (Task 5 below).
3. **Bootstrapping the first auditor** is done once, out-of-band, via a direct D1 command:
   ```bash
   npx wrangler d1 execute civicdoodie-parking-db-local --local \
     --command "UPDATE \"user\" SET role = 'auditor' WHERE email = 'you@example.com';"
   ```
   This requires no code path and leaves no special credentials in the codebase.

---

## Files Changed

| File | Action | What it does |
|------|--------|-------------|
| `migrations/0008_auth_email_password.sql` | **Create** | Adds `role` column to `user` table |
| `src/auth.ts` | **Modify** | Adds `emailAndPassword` plugin + `user.additionalFields` for `role` |
| `src/schemas.ts` | **Modify** | Adds `role` field to `ProfileUser` schema |
| `src/routes/profile.ts` | **Modify** | SELECTs `role` from DB, includes in profile response |
| `src/routes/admin.ts` | **Modify** | Adds `POST /api/admin/users/:id/promote-auditor` |
| `mockups/civicdoodies.html` | **Modify** (Task 5) | Adds `currentUser` state, `refreshAuth()`, `updateAuthUI()`, `signOut()`, `escapeHtml()`; swaps the two static auth nav buttons for a `#nav-auth` container; calls `refreshAuth()` on load |
| `mockups/civicdoodies.html` | **Modify** (Task 6) | Adds `authRequest()` helper, a "Remember me" checkbox to the modal, and rewrites `submitSignIn()` to call the real `/api/auth/*` endpoints |
| `mockups/civicdoodies.html` | **Modify** (Task 7) | Renders the auditor table Edit column only when `currentUser.role === 'auditor'` |

---

## Task 1: Migration — add `role` column

**Files:**
- Create: `migrations/0008_auth_email_password.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 0008_auth_email_password.sql
-- Adds role column for user/auditor distinction.
-- All existing rows default to 'user'.
ALTER TABLE "user" ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'auditor'));
```

- [ ] **Step 2: Apply locally**

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local \
  --file migrations/0008_auth_email_password.sql
```
Expected: `Successfully executed 1 command.`

- [ ] **Step 3: Commit**

```bash
git add migrations/0008_auth_email_password.sql
git commit -m "feat(db): add role column to user table (user|auditor)"
```

---

## Task 2: Backend — enable emailAndPassword in auth.ts

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Add the plugin and additionalFields**

Replace the import line and `betterAuth({...})` call in `src/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { bearer, emailAndPassword } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

// ... AuthEnv type unchanged ...

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
    plugins: [
      bearer(),
      emailAndPassword({ enabled: true, requireEmailVerification: false }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryan/Desktop/CivicDoodie-Parking && npx tsc --noEmit
```
Expected: no errors (or same errors as before this change).

- [ ] **Step 3: Commit**

```bash
git add src/auth.ts
git commit -m "feat(auth): enable emailAndPassword plugin + expose role additionalField"
```

---

## Task 3: Backend — expose `role` on profile API

**Files:**
- Modify: `src/schemas.ts` (add `role` to ProfileUser)
- Modify: `src/routes/profile.ts` (SELECT + return `role`)

- [ ] **Step 1: Add `role` to ProfileUser schema in `src/schemas.ts`**

Find the `ProfileUser` object definition and add `role` after `terms_accepted_at`:

```ts
export const ProfileUser = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    screen_name: z.string().nullable(),
    screen_name_suggestion: z.string().nullable(),
    city: z.string().nullable(),
    state_or_region: z.string().nullable(),
    country: z.string().nullable(),
    brownie_points: z.number().int(),
    status: UserStatus,
    terms_accepted_at: z.string().nullable(),
    role: z.enum(["user", "auditor"]),
    created_at: z.string().nullable(),
    profile_complete: z.boolean(),
    accounts: z.array(LinkedAccount),
  })
  .openapi("ProfileUser");
```

- [ ] **Step 2: Update the SELECT query in `src/routes/profile.ts`**

Find the GET profile handler. It queries the `user` table — add `role` to the SELECT and the returned object. The query currently selects `screen_name, screen_name_suggestion, city, state_or_region, country, brownie_points, status, terms_accepted_at, createdAt`. Add `role`:

```ts
const row = await c.env.DB.prepare(
  `SELECT id, name, email, image, screen_name, city, state_or_region, country,
          brownie_points, status, terms_accepted_at, role, createdAt
   FROM "user" WHERE id = ?`
)
  .bind(userId)
  .first<{
    id: string;
    name: string;
    email: string;
    image: string | null;
    screen_name: string | null;
    city: string | null;
    state_or_region: string | null;
    country: string | null;
    brownie_points: number;
    status: string;
    terms_accepted_at: string | null;
    role: "user" | "auditor";
    createdAt: string;
  }>();
```

And in the returned object, include:

```ts
role: (row?.role ?? "user") as "user" | "auditor",
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/schemas.ts src/routes/profile.ts
git commit -m "feat(profile): expose role field on GET /api/profile"
```

---

## Task 4: Backend — auditor promotion endpoint

**Files:**
- Modify: `src/routes/admin.ts`

- [ ] **Step 1: Add the promote-auditor route at the bottom of `src/routes/admin.ts`**

```ts
// POST /api/admin/users/:id/promote-auditor
// Requires the calling user to be an auditor themselves.
admin.post("/users/:id/promote-auditor", async (c) => {
  const actor = c.get("user");

  const actorRow = await c.env.DB.prepare(
    `SELECT role FROM "user" WHERE id = ?`
  )
    .bind(actor.id)
    .first<{ role: string }>();
  if (actorRow?.role !== "auditor") {
    return c.json({ error: "Not found" }, 404);
  }

  const targetId = c.req.param("id")!;
  const target = await c.env.DB.prepare(
    `SELECT id, role FROM "user" WHERE id = ?`
  )
    .bind(targetId)
    .first<{ id: string; role: string }>();
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.role === "auditor") return c.json({ ok: true, changed: false });

  await c.env.DB.prepare(
    `UPDATE "user" SET role = 'auditor', updatedAt = datetime('now') WHERE id = ?`
  )
    .bind(targetId)
    .run();

  return c.json({ ok: true, changed: true });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat(admin): add POST /api/admin/users/:id/promote-auditor"
```

---

## Task 5: Frontend — auth state + header reflection (HTML mockup)

This task adds the `currentUser` state object, the session loader, the header rendering, and sign-out. It defines `refreshAuth()`, which Task 6 calls after a successful sign-in/sign-up, and `currentUser`, which Task 7 reads to gate the Edit column. **Do this task before Task 6** so those references exist.

**Files:**
- Modify: `mockups/civicdoodies.html`

- [ ] **Step 1: Swap the two static auth nav buttons for a container**

In the header `<nav>` (around line 264), the current markup is:

```html
      <button class="nav-link" onclick="go('map')">Mismatch map</button>
      <button class="nav-link" onclick="go('audit')">Auditor</button>
      <button class="nav-link" onclick="openSignIn('signin')">Sign in</button>
      <button class="nav-link" onclick="openSignIn('create')">Create account</button>
      <button class="nav-link cta" onclick="startCheck()">Report or check a zone</button>
```

Replace the two auth buttons (Sign in / Create account) with a single container that `updateAuthUI()` fills:

```html
      <button class="nav-link" onclick="go('map')">Mismatch map</button>
      <button class="nav-link" onclick="go('audit')">Auditor</button>
      <span id="nav-auth"></span>
      <button class="nav-link cta" onclick="startCheck()">Report or check a zone</button>
```

- [ ] **Step 2: Add CSS for the badge, the user name, and (used in Task 6) the remember-me row**

In the `<style>` block, near the existing `.nav-link` rules (around line 42-45), add:

```css
  .auditor-badge { display:inline-block; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; padding:3px 8px; border-radius:100px; background:var(--signal); color:#fff; margin-right:4px; }
  .nav-user { font-size:14px; font-weight:500; color:var(--ink); padding:8px 4px; }
  .signin-remember { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-soft); margin-bottom:16px; }
```

- [ ] **Step 3: Add the auth-state functions**

Insert this block immediately after the `submitSignIn()` function (just before the `/* ---------- navigation ---------- */` comment, around line 775):

```js
/* ---------- auth state ---------- */
var currentUser = null; // { name, role } when signed in, otherwise null

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Render the auth slot in the header from currentUser.
function updateAuthUI(){
  var el = document.getElementById('nav-auth');
  if(!el) return;
  if(currentUser){
    var badge = currentUser.role === 'auditor'
      ? '<span class="auditor-badge">Auditor</span>'
      : '';
    el.innerHTML =
      badge +
      '<span class="nav-user">' + escapeHtml(currentUser.name || 'Account') + '</span>' +
      '<button class="nav-link" onclick="signOut()">Sign out</button>';
  } else {
    el.innerHTML =
      '<button class="nav-link" onclick="openSignIn(\'signin\')">Sign in</button>' +
      '<button class="nav-link" onclick="openSignIn(\'create\')">Create account</button>';
  }
}

// Read the current better-auth session and store name + role in currentUser.
// Called on load and after a successful sign-in/sign-up/sign-out.
function refreshAuth(){
  return fetch(API_BASE + '/api/auth/get-session', { credentials: 'include' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      currentUser = (data && data.user)
        ? { name: data.user.name, role: data.user.role || 'user' }
        : null;
      updateAuthUI();
      // If the auditor table is on screen, re-render so the Edit column
      // appears/disappears for the new role.
      if(document.getElementById('screen-audit').classList.contains('active')){
        renderAuditTable();
      }
    })
    .catch(function(){ currentUser = null; updateAuthUI(); });
}

function signOut(){
  fetch(API_BASE + '/api/auth/sign-out', { method: 'POST', credentials: 'include' })
    .catch(function(){ /* ignore network error — clear local state regardless */ })
    .then(function(){
      currentUser = null;
      updateAuthUI();
      go('landing');
    });
}
```

- [ ] **Step 4: Call `refreshAuth()` on page load**

At the very bottom of the script (the last executable line is `renderStats();`, around line 1813), add a call so the header reflects the session immediately:

```js
renderStats();
refreshAuth();
```

- [ ] **Step 5: Verify no smart/curly quotes were introduced**

Editing JS strings in this HTML file can silently insert curly quotes (`'` `'` `"` `"`) that break the script. Run:

```bash
python3 -c "
b=open('mockups/civicdoodies.html','rb').read()
bad=[m for m in [b'\xe2\x80\x98',b'\xe2\x80\x99',b'\xe2\x80\x9c',b'\xe2\x80\x9d'] if m in b]
print('CURLY QUOTES FOUND' if bad else 'clean: no curly quotes')
"
```
Expected: `clean: no curly quotes`. If it reports curly quotes, replace them with straight quotes before continuing.

- [ ] **Step 6: Commit**

```bash
git add mockups/civicdoodies.html
git commit -m "feat(mockup): add auth state, session loader, and header reflection"
```

---

## Task 6: Frontend — wire the sign-in/create modal to better-auth (HTML mockup)

The modal currently validates input and runs a mock `setTimeout`+`alert`. This task replaces the mock with real calls to better-auth's HTTP endpoints and adds the "Remember me" checkbox the spec requires.

**Note on the auditor radio:** sign-up always creates a regular `user`. The backend's `role` additionalField has `input: false`, so the role can never be set by the client — whatever radio is selected, a regular account is created. The auditor radio and its warning stay as-is (informational); promotion to auditor happens out-of-band (Role Strategy section + Task 4). No code is needed to "block" auditor self-creation — the server already ignores the field.

**Files:**
- Modify: `mockups/civicdoodies.html`

- [ ] **Step 1: Add the `authRequest()` helper**

Insert immediately after the `apiFetch()` function (around line 624):

```js
// better-auth HTTP wrapper. POSTs JSON to /api/auth/<path>, sends the session
// cookie, and surfaces better-auth's { message } error shape on failure.
function authRequest(path, body){
  return fetch(API_BASE + '/api/auth' + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(data){
      if(!r.ok){
        throw new Error((data && (data.message || data.error)) || ('HTTP ' + r.status));
      }
      return data;
    });
  });
}
```

- [ ] **Step 2: Add the "Remember me" checkbox to the modal**

In the modal markup, the password input is followed directly by the confirm-password wrapper (around lines 327-329):

```html
    <label class="field-label" for="signin-password">Password</label>
    <input id="signin-password" class="field-input" type="password" placeholder="Password" autocomplete="current-password" />
    <div id="signin-confirm-wrap" style="display:none;">
```

Insert the remember-me row between the password input and `signin-confirm-wrap`:

```html
    <label class="field-label" for="signin-password">Password</label>
    <input id="signin-password" class="field-input" type="password" placeholder="Password" autocomplete="current-password" />
    <label class="signin-remember" id="signin-remember-wrap">
      <input type="checkbox" id="signin-remember" checked /> Keep me signed in
    </label>
    <div id="signin-confirm-wrap" style="display:none;">
```

- [ ] **Step 3: Toggle the remember-me row by mode in `applySignInMode()`**

`applySignInMode()` (around line 711) already toggles the create-only fields. Add one line so "Remember me" shows only in sign-in mode. After the existing `signin-confirm-wrap` display line (line 716), add:

```js
  document.getElementById('signin-remember-wrap').style.display = isCreate ? 'none' : 'flex';
```

- [ ] **Step 4: Rewrite `submitSignIn()` to call the real endpoints**

Replace the entire `submitSignIn()` function (currently around lines 751-774, ending with the mock `setTimeout`) with:

```js
function submitSignIn(){
  var email = document.getElementById('signin-email').value.trim();
  var password = document.getElementById('signin-password').value;
  if(!email || !password){ showSignInError('Email and password are required.'); return; }

  var path, payload;
  if(signinMode === 'create'){
    var country = document.getElementById('signin-country').value.trim();
    if(!country){ showSignInError('Country is required.'); return; }
    var confirmPw = document.getElementById('signin-confirm').value;
    if(password !== confirmPw){ showSignInError("Passwords don't match."); return; }
    var display = document.getElementById('signin-display').value.trim();
    var first = document.getElementById('signin-first').value.trim();
    var last = document.getElementById('signin-last').value.trim();
    var name = display || (first + ' ' + last).trim() || email.split('@')[0];
    path = '/sign-up/email';
    payload = { name: name, email: email, password: password, callbackURL: '/' };
  } else {
    var remember = document.getElementById('signin-remember').checked;
    path = '/sign-in/email';
    payload = { email: email, password: password, rememberMe: remember, callbackURL: '/' };
  }

  showSignInError('');
  var btn = document.getElementById('signin-submit');
  btn.disabled = true;
  btn.textContent = signinMode === 'create' ? 'Creating…' : 'Signing in…';

  authRequest(path, payload)
    .then(function(){ return refreshAuth(); })
    .then(function(){
      btn.disabled = false;
      applySignInMode();
      closeSignIn();
    })
    .catch(function(err){
      btn.disabled = false;
      applySignInMode();
      showSignInError(err.message || 'Something went wrong.');
    });
}
```

- [ ] **Step 5: Verify no smart/curly quotes were introduced**

```bash
python3 -c "
b=open('mockups/civicdoodies.html','rb').read()
bad=[m for m in [b'\xe2\x80\x98',b'\xe2\x80\x99',b'\xe2\x80\x9c',b'\xe2\x80\x9d'] if m in b]
print('CURLY QUOTES FOUND' if bad else 'clean: no curly quotes')
"
```
Expected: `clean: no curly quotes`. Note: the `…` escapes above produce the ellipsis character at runtime without putting any non-ASCII byte in the source, so they are intentional and safe.

- [ ] **Step 6: Commit**

```bash
git add mockups/civicdoodies.html
git commit -m "feat(mockup): wire sign-in/create modal to better-auth email endpoints"
```

---

## Task 7: Frontend — gate the auditor table Edit column (HTML mockup)

Only auditors should see the Edit column and be able to open the row editor. The table keeps all 8 columns for every viewer (so the layout is stable); the last cell is empty and the row is non-clickable for non-auditors.

**Files:**
- Modify: `mockups/civicdoodies.html`

- [ ] **Step 1: Compute `canEdit` and gate the row in `renderAuditTable()`**

In `renderAuditTable()` (around line 1719), the rows are built like this:

```js
    tbody.innerHTML = rows.map(function(z){
      var s = statusById(z.fix_state);
      return '<tr onclick="openAuditEditor(\''+z.slug+'\',\''+z.town_slug+'\')">' +
        '<td class="id-cell" style="font-size:12px;">'+z.slug+'</td>'+
        '<td class="zone-cell">'+z.type+'</td>'+
        '<td>'+(z.town_name||z.town_slug)+'</td>'+
        '<td class="num">'+z.report_count+'</td>'+
        '<td><span class="status-badge '+s.tone+'">'+s.label+'</span></td>'+
        '<td>—</td>'+
        '<td>—</td>'+
        '<td class="actions-cell">Edit →</td>'+
      '</tr>';
    }).join('');
```

Replace that block with a version that gates the row click and the Edit cell on `currentUser.role`:

```js
    var canEdit = !!(currentUser && currentUser.role === 'auditor');
    tbody.innerHTML = rows.map(function(z){
      var s = statusById(z.fix_state);
      var rowOpen = canEdit
        ? ' onclick="openAuditEditor(\''+z.slug+'\',\''+z.town_slug+'\')" style="cursor:pointer;"'
        : '';
      var editCell = canEdit ? '<td class="actions-cell">Edit →</td>' : '<td class="actions-cell"></td>';
      return '<tr'+rowOpen+'>' +
        '<td class="id-cell" style="font-size:12px;">'+z.slug+'</td>'+
        '<td class="zone-cell">'+z.type+'</td>'+
        '<td>'+(z.town_name||z.town_slug)+'</td>'+
        '<td class="num">'+z.report_count+'</td>'+
        '<td><span class="status-badge '+s.tone+'">'+s.label+'</span></td>'+
        '<td>—</td>'+
        '<td>—</td>'+
        editCell+
      '</tr>';
    }).join('');
```

- [ ] **Step 2: Verify no smart/curly quotes were introduced**

```bash
python3 -c "
b=open('mockups/civicdoodies.html','rb').read()
bad=[m for m in [b'\xe2\x80\x98',b'\xe2\x80\x99',b'\xe2\x80\x9c',b'\xe2\x80\x9d'] if m in b]
print('CURLY QUOTES FOUND' if bad else 'clean: no curly quotes')
"
```
Expected: `clean: no curly quotes`. (The `—` em-dashes in the two placeholder cells were already in the file and are fine — they live in HTML text, not JS string quotes.)

- [ ] **Step 3: Commit**

```bash
git add mockups/civicdoodies.html
git commit -m "feat(mockup): show auditor table Edit column only for auditors"
```

---

## Task 8: End-to-end manual verification

No code — this verifies the full pipeline works against the local Worker. There is no automated test harness for the mockup, so this is the acceptance gate.

**Cookie/origin requirement (important):** the mockup talks to the Worker at `http://localhost:8787` via `credentials: 'include'`. better-auth's session cookie is `SameSite=Lax` in local dev. A page opened as `file://` has origin `null` (cross-site) and the cookie will **not** be sent, so sign-in will appear to "succeed" but the session won't stick. Serve the mockup over **http on localhost** so it is same-site with the Worker (different ports on `localhost` are still same-site).

- [ ] **Step 1: Apply the migration and start the Worker**

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local \
  --file migrations/0008_auth_email_password.sql
npx wrangler dev
```

- [ ] **Step 2: Serve the mockup over http (separate terminal)**

```bash
cd /Users/ryan/Desktop/CivicDoodie-Parking/mockups && python3 -m http.server 5050
```
Open `http://localhost:5050/civicdoodies.html`.

- [ ] **Step 3: Create a regular account**

Click "Create account", fill name / country / email / password (+ confirm), submit. Expected: modal closes, header shows your name + "Sign out" (no Auditor badge).

- [ ] **Step 4: Confirm non-auditor sees no Edit column**

Click "Auditor". Expected: table renders, the last column is empty, rows are not clickable (no editor opens on click).

- [ ] **Step 5: Sign out, then sign back in**

Click "Sign out" → header returns to "Sign in / Create account", lands on home. Click "Sign in", enter the same email/password, check "Keep me signed in", submit. Expected: header shows your name again. Reload the page — you stay signed in.

- [ ] **Step 6: Promote yourself to auditor and verify the Edit column appears**

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local \
  --command "UPDATE \"user\" SET role = 'auditor' WHERE email = 'you@example.com';"
```
Reload the mockup. Expected: header shows the "Auditor" badge. Open "Auditor" → the Edit column shows "Edit →", rows are clickable, and the editor opens and saves (`PATCH` succeeds).

- [ ] **Step 7: Confirm Google OAuth still works**

From a signed-out state, complete a Google sign-in (existing flow). Expected: it still authenticates and the header shows the Google account name — proving email/password was added without breaking OAuth.

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|-------------|------|
| Enable emailAndPassword without breaking Google OAuth | Task 2 (server), Task 8 Step 7 (verified) |
| New accounts default to `user` role | Task 2 (`defaultValue: "user"`, `input: false`) + Task 1 (DB default) |
| Auditors cannot self-create — promoted by existing auditor | Task 4 (endpoint), Task 6 note (client cannot set role), Role Strategy |
| Bootstrap first auditor via wrangler | Role Strategy section + Task 8 Step 6 |
| `role` column on user table | Task 1 |
| `role` exposed on session/profile | Task 2 (additionalField rides on `get-session`), Task 3 (profile API) |
| Regular users + unauthenticated: see app, no Edit column | Task 7 (`canEdit` false → empty cell, no row click) |
| Auditors: see Edit column | Task 7 (`canEdit` true) |
| Sign-up form (name, email, password) | Task 6 (`/sign-up/email`) — existing modal markup already collects fields |
| Sign-in form (email, password, remember me) | Task 6 (remember-me checkbox + `rememberMe` flag) |
| Wire to `/api/auth/sign-up/email` / `/api/auth/sign-in/email` | Task 6 (`authRequest`) |
| Sign-out → redirect home | Task 5 (`signOut()` → `go('landing')`) |
| Header: unauthenticated → "Sign in" (+ "Create account") | Task 5 (`updateAuthUI` else branch) |
| Header: regular user → name + sign-out | Task 5 (`updateAuthUI` if branch, no badge) |
| Header: auditor → name + "Auditor" badge + sign-out | Task 5 (`updateAuthUI` if branch, badge) |
| Session loaded on page load | Task 5 (`refreshAuth()` at bottom of script) |

**Placeholder scan:** No TBDs or "implement later". Every code step shows complete code.

**Type/identifier consistency:** `currentUser` is `{ name, role }` or `null` everywhere (Tasks 5-7). `role` values are `"user" | "auditor"` across DB (Task 1), profile schema (Task 3), and `currentUser.role` checks (Tasks 5, 7). `refreshAuth()`, `updateAuthUI()`, `signOut()`, `escapeHtml()`, `authRequest()` are each defined once (Tasks 5-6) before any caller runs. The `#nav-auth` container (Task 5 Step 1) is the only element `updateAuthUI()` writes to. The remember-me element id `signin-remember` is defined in Task 6 Step 2 and read in Task 6 Step 4; `signin-remember-wrap` is toggled in Task 6 Step 3.

**Known forward dependency (resolved):** Task 6's `submitSignIn()` calls `refreshAuth()`, defined in Task 5 — that's why Task 5 is sequenced first.
