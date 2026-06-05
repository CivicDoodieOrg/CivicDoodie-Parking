# Community Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global, app-wide community message board to the feed widget — signed-in users post short messages, banned words are censored server-side (`****`), and offending messages are flagged for accountability.

**Architecture:** New `community_message` D1 table; a pure `censor()` helper (unit-tested with vitest); a `/api/community` Hono route group (public GET, auth-gated POST); and a "Reports | Community" tab inside the existing feed panel in `mockups/civicdoodies.html`. The server is the single source of truth for censoring; the client only displays what it receives.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), better-auth (existing session/auth), vanilla JS in the HTML mockup, vitest (for the one pure-function unit test).

**Testing reality:** This project has `vitest` but no existing tests and no Workers/D1 test harness. So: `censor()` is TDD'd with a real vitest unit test; the D1 routes and mockup are verified with curl and manual browser checks (the same way the rest of this codebase is verified).

---

## Files Changed

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/0012_community_messages.sql` | **Create** | `community_message` table + index |
| `src/lib/banned-words.ts` | **Create** | Banned-word list + pure `censor()` |
| `src/lib/banned-words.test.ts` | **Create** | vitest unit tests for `censor()` |
| `src/routes/community.ts` | **Create** | `GET`/`POST /api/community/messages` |
| `src/schemas.ts` | **Modify** | `CommunityMessage` OpenAPI schema |
| `src/index.ts` | **Modify** | Mount `/api/community` |
| `mockups/civicdoodies.html` | **Modify** | Reports/Community tab + message list + compose box |

---

## Task 1: Migration — `community_message` table

**Files:**
- Create: `migrations/0012_community_messages.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 0012_community_messages.sql
-- Global community message board. body is stored ALREADY censored;
-- flagged=1 marks messages that tripped the banned-word filter, so offending
-- users are identifiable via (user_id, flagged).
CREATE TABLE IF NOT EXISTS community_message (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  flagged     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_message_created ON community_message(created_at);
```

- [ ] **Step 2: Apply locally**

Run:
```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --file migrations/0012_community_messages.sql
```
Expected: `Executed ... commands` with no error.

- [ ] **Step 3: Verify the table exists**

Run:
```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --command "SELECT name FROM pragma_table_info('community_message');"
```
Expected: rows for `id, user_id, author_name, body, flagged, created_at`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0012_community_messages.sql
git commit -m "feat(db): add community_message table"
```

---

## Task 2: `censor()` banned-word helper (TDD)

**Files:**
- Create: `src/lib/banned-words.ts`
- Test: `src/lib/banned-words.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/banned-words.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { censor } from "./banned-words";

describe("censor", () => {
  it("replaces a whole banned word with **** and flags it", () => {
    const r = censor("oh damn that hurts");
    expect(r.body).toBe("oh **** that hurts");
    expect(r.flagged).toBe(true);
  });

  it("leaves clean text untouched and unflagged", () => {
    const r = censor("the meter is broken");
    expect(r.body).toBe("the meter is broken");
    expect(r.flagged).toBe(false);
  });

  it("is case-insensitive", () => {
    const r = censor("DAMN it");
    expect(r.body).toBe("**** it");
    expect(r.flagged).toBe(true);
  });

  it("does not censor a banned word embedded in a clean word (whole-word only)", () => {
    // "class" contains "ass" but must NOT be censored
    const r = censor("the class was great");
    expect(r.body).toBe("the class was great");
    expect(r.flagged).toBe(false);
  });

  it("censors multiple banned words in one message", () => {
    const r = censor("damn and hell");
    expect(r.body).toBe("**** and ****");
    expect(r.flagged).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
npx vitest run src/lib/banned-words.test.ts
```
Expected: FAIL — cannot resolve `./banned-words` (module does not exist yet).

- [ ] **Step 3: Implement `src/lib/banned-words.ts`**

```ts
// Lowercase banned words. Whole-word, case-insensitive matching.
// This is the single place to edit the list.
export const BANNED_WORDS: string[] = [
  "damn", "hell", "crap", "ass", "bastard", "bitch",
  "shit", "piss", "dick", "douche", "jackass", "asshole",
];

// Replace each whole-word banned term (case-insensitive) with "****".
// Returns the censored text and whether anything was censored.
export function censor(text: string): { body: string; flagged: boolean } {
  if (BANNED_WORDS.length === 0) return { body: text, flagged: false };
  let flagged = false;
  const escaped = BANNED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
  const body = text.replace(re, () => {
    flagged = true;
    return "****";
  });
  return { body, flagged };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run:
```bash
npx vitest run src/lib/banned-words.test.ts
```
Expected: PASS — 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/banned-words.ts src/lib/banned-words.test.ts
git commit -m "feat(community): add banned-word censor() helper with unit tests"
```

---

## Task 3: `/api/community` routes (GET + POST)

**Files:**
- Create: `src/routes/community.ts`
- Modify: `src/schemas.ts` (add `CommunityMessage`)
- Modify: `src/index.ts` (mount route)

- [ ] **Step 1: Create `src/routes/community.ts`**

```ts
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AuthEnv } from "../auth";
import { censor } from "../lib/banned-words";

type Env = {
  Bindings: AuthEnv & {
    DB: D1Database;
    IMAGES: R2Bucket;
    ASSETS: Fetcher;
    ADMIN_USER_IDS: string;
  };
  Variables: {
    user: { id: string; email: string; name: string; image?: string | null };
    session: { id: string; userId: string; expiresAt: Date };
  };
};

const MESSAGE_MAX = 280;

type MessageRow = {
  id: string;
  author_name: string;
  body: string;
  flagged: number;
  created_at: string;
};

function toMessage(m: MessageRow) {
  return {
    id: m.id,
    author_name: m.author_name,
    body: m.body,
    flagged: Boolean(m.flagged),
    created_at: m.created_at,
  };
}

export const community = new Hono<Env>();

// GET /api/community/messages?limit=50 — public. Most recent N, oldest-first.
community.get("/messages", async (c) => {
  const raw = parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Math.min(100, Math.max(1, Number.isNaN(raw) ? 50 : raw));
  const rows = await c.env.DB.prepare(
    `SELECT id, author_name, body, flagged, created_at
       FROM community_message
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  )
    .bind(limit)
    .all<MessageRow>();
  const messages = (rows.results ?? []).map(toMessage).reverse();
  return c.json({ messages });
});

// POST /api/community/messages — requires sign-in. Censors + stores + flags.
community.post("/messages", requireAuth, async (c) => {
  const user = c.get("user");
  const parsed = await c.req
    .json<{ body?: unknown }>()
    .catch(() => ({}) as { body?: unknown });
  const text = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (text.length < 1 || text.length > MESSAGE_MAX) {
    return c.json({ error: `body must be 1–${MESSAGE_MAX} characters` }, 400);
  }

  const { body, flagged } = censor(text);

  const urow = await c.env.DB.prepare(
    `SELECT username, name FROM "user" WHERE id = ?`
  )
    .bind(user.id)
    .first<{ username: string | null; name: string | null }>();
  const authorName = urow?.username || urow?.name || "someone";

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO community_message (id, user_id, author_name, body, flagged)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, authorName, body, flagged ? 1 : 0)
    .run();

  const created = await c.env.DB.prepare(
    `SELECT id, author_name, body, flagged, created_at FROM community_message WHERE id = ?`
  )
    .bind(id)
    .first<MessageRow>();

  return c.json({ message: toMessage(created!) }, 201);
});
```

- [ ] **Step 2: Add the `CommunityMessage` schema to `src/schemas.ts`**

Append near the other response schemas (e.g., after `CommentItem`):
```ts
export const CommunityMessage = z
  .object({
    id: z.string(),
    author_name: z.string(),
    body: z.string(),
    flagged: z.boolean(),
    created_at: z.string(),
  })
  .openapi("CommunityMessage");
```

- [ ] **Step 3: Mount the route in `src/index.ts`**

Add the import alongside the other route imports (near `import { admin } from "./routes/admin";`):
```ts
import { community } from "./routes/community";
```

Add `.route("/api/community", community)` to the `routes` chain (after `.route("/api/admin", admin)`):
```ts
const routes = app
  .route("/api/profile", profile)
  .route("/api/towns", towns)
  .route("/api/towns/:townSlug/doodies", doodies)
  .route("/api/towns/:townSlug/checks", checks)
  .route("/api/towns/:townSlug/doodies/:doodieSlug/comments", doodieComments)
  .route("/api/towns/:townSlug/dashboard", dashboard)
  .route("/api/comments", comments)
  .route("/api/admin", admin)
  .route("/api/community", community);
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: clean (no errors).

- [ ] **Step 5: Verify with the running Worker (curl)**

Start the Worker if not running (`npx wrangler dev`), then:

GET (public, empty to start):
```bash
curl -s http://localhost:8787/api/community/messages | head -c 200
```
Expected: `{"messages":[]}`.

POST without auth → 401:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/community/messages -d '{"body":"hello"}'
```
Expected: `401`.

POST with a session cookie (sign up a throwaway user to get one), including a banned word:
```bash
TS=$(date +%s)
curl -s -c /tmp/cm.txt -o /dev/null -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/auth/sign-up/email \
  -d '{"name":"msg_'"$TS"'","email":"msg-'"$TS"'@example.com","password":"testpass1234","username":"msg_'"$TS"'"}'
curl -s -b /tmp/cm.txt -H "Origin: http://localhost:5050" -H "Content-Type: application/json" \
  -X POST http://localhost:8787/api/community/messages -d '{"body":"oh damn the meter"}'
```
Expected: `201` with `{"message":{...,"body":"oh **** the meter","flagged":true,"author_name":"msg_..."}}`.

GET again shows it:
```bash
curl -s http://localhost:8787/api/community/messages
```
Expected: the censored message in `messages` (oldest-first).

- [ ] **Step 6: Commit**

```bash
git add src/routes/community.ts src/schemas.ts src/index.ts
git commit -m "feat(community): add /api/community/messages (public GET, auth POST, censored)"
```

---

## Task 4: Mockup — Reports/Community tab shell (HTML + CSS)

**Files:**
- Modify: `mockups/civicdoodies.html`

This task adds the tab toggle and the (empty) Community tab container. Wiring comes in Task 5.

- [ ] **Step 1: Add the tab toggle + community container to the panel markup**

Find the panel body (the `#feed-panel-filters` and `#feed-panel-list` block inside `#feed-panel`). Insert a tab row **before** `#feed-panel-filters`, and add the community container **after** `#feed-panel-list`. The panel inner becomes:

```html
    <div class="feed-tabs" id="feed-tabs">
      <button type="button" class="feed-tab active" id="feed-tab-reports" onclick="switchFeedTab('reports')">Reports</button>
      <button type="button" class="feed-tab" id="feed-tab-community" onclick="switchFeedTab('community')">Community</button>
    </div>
    <div class="feed-panel-filters" id="feed-panel-filters">
      <div class="feed-chips" id="feed-chips"></div>
      <div class="feed-townpicker" id="feed-townpicker" style="display:none;">
        <input class="feed-townsearch" id="feed-townsearch" type="text" placeholder="Search towns with reports…" oninput="renderTownList(this.value)" />
        <div class="feed-townlist" id="feed-townlist"></div>
      </div>
    </div>
    <div class="feed-panel-list" id="feed-panel-list"></div>
    <div class="feed-community" id="feed-community" style="display:none;">
      <div class="feed-msg-list" id="feed-msg-list"></div>
      <div class="feed-compose" id="feed-compose"></div>
    </div>
```

(Keep the existing inner content of `#feed-panel-filters` exactly as it already is — shown above for placement.)

- [ ] **Step 2: Add CSS for the tabs, message list, and compose row**

Add near the other `.feed-*` rules in the `<style>` block:
```css
  .feed-tabs { display:flex; gap:4px; padding:8px 14px 0; }
  .feed-tab { flex:1; background:none; border:none; border-bottom:2px solid transparent; padding:8px 0; font-family:var(--font-body); font-size:13px; font-weight:500; color:var(--ink-soft); cursor:pointer; }
  .feed-tab.active { color:var(--signal-dark); border-bottom-color:var(--signal); }
  .feed-community { flex:1; display:flex; flex-direction:column; min-height:0; }
  .feed-msg-list { flex:1; overflow-y:auto; padding:10px 16px; display:flex; flex-direction:column; gap:12px; }
  .feed-msg { font-size:13px; line-height:1.45; }
  .feed-msg-head { display:flex; align-items:baseline; gap:8px; margin-bottom:1px; }
  .feed-msg-author { font-weight:600; color:var(--ink); }
  .feed-msg-when { font-size:11px; color:var(--ink-faint); }
  .feed-msg-body { color:var(--ink); white-space:pre-wrap; word-break:break-word; }
  .feed-compose { border-top:1px solid var(--line); padding:10px 14px; display:flex; gap:8px; align-items:center; }
  .feed-compose input { flex:1; box-sizing:border-box; padding:9px 11px; border:1px solid var(--line-strong); border-radius:8px; background:var(--paper-card); color:var(--ink); font-family:var(--font-body); font-size:13px; }
  .feed-compose input:focus { outline:none; border-color:var(--signal); box-shadow:0 0 0 3px var(--signal-wash); }
  .feed-compose .btn-send { background:var(--signal); border:none; color:#fff; border-radius:8px; padding:9px 14px; font-family:var(--font-body); font-size:13px; font-weight:500; cursor:pointer; }
  .feed-compose .btn-send:disabled { opacity:.5; cursor:default; }
  .feed-signin-cta { padding:12px 14px; border-top:1px solid var(--line); text-align:center; font-size:13px; color:var(--ink-soft); }
  .feed-signin-cta a { color:var(--signal-dark); font-weight:500; cursor:pointer; }
```

- [ ] **Step 3: Verify no smart/curly quotes were introduced**

Run:
```bash
python3 -c "
b=open('mockups/civicdoodies.html','rb').read()
bad=[m for m in [b'\xe2\x80\x98',b'\xe2\x80\x99',b'\xe2\x80\x9c',b'\xe2\x80\x9d'] if m in b]
print('CURLY QUOTES FOUND' if bad else 'clean: no curly quotes')
"
```
Expected: `clean: no curly quotes`.

- [ ] **Step 4: Commit**

```bash
git add mockups/civicdoodies.html
git commit -m "feat(mockup): add Reports/Community tab shell to the feed panel"
```

---

## Task 5: Mockup — Community tab behavior (JS)

**Files:**
- Modify: `mockups/civicdoodies.html`

- [ ] **Step 1: Add the message state + tab switching**

Insert near the other feed state (right after `var feedError = false;`):
```js
var feedTab = 'reports';   // 'reports' | 'community'
var feedMessages = null;   // cached community messages, or null before first load
var feedMsgError = false;

// Switch tabs: toggle which content is visible and load the active tab's data.
function switchFeedTab(tab){
  feedTab = tab;
  var isCommunity = (tab === 'community');
  document.getElementById('feed-tab-reports').classList.toggle('active', !isCommunity);
  document.getElementById('feed-tab-community').classList.toggle('active', isCommunity);
  document.getElementById('feed-panel-filters').style.display = isCommunity ? 'none' : 'block';
  document.getElementById('feed-panel-list').style.display = isCommunity ? 'none' : 'block';
  document.getElementById('feed-community').style.display = isCommunity ? 'flex' : 'none';
  refreshActiveTab(false);
}

// Refresh whichever tab is active (used by open, interval, visibility, tab switch).
function refreshActiveTab(silent){
  if(feedTab === 'community') refreshMessages(silent);
  else refreshFeedData(silent);
}
```

- [ ] **Step 2: Add message fetch + render**

Insert after `refreshActiveTab` (uses existing `apiFetch`, `escapeHtml`, `feedTimeAgo`, `feedParseTime`, `currentUser`):
```js
// Fetch the community messages, then re-render. silent=true skips the spinner.
function refreshMessages(silent){
  if(!silent){ feedMsgError = false; renderMessages(); }
  return apiFetch('/api/community/messages')
    .then(function(d){ feedMessages = d.messages || []; renderMessages(); })
    .catch(function(){ if(!silent){ feedMsgError = true; } renderMessages(); });
}

function renderMessages(){
  renderCompose();
  var host = document.getElementById('feed-msg-list');
  if(!host) return;
  if(feedMessages === null){
    host.innerHTML = feedMsgError
      ? '<div class="feed-empty">Couldn\'t load messages. <button type="button" class="feed-empty-action" onclick="refreshMessages()">Retry</button></div>'
      : '<div class="spinner"></div>';
    return;
  }
  if(feedMessages.length === 0){
    host.innerHTML = '<div class="feed-empty">No messages yet — say hello.</div>';
    return;
  }
  host.innerHTML = feedMessages.map(function(m){
    var when = escapeHtml(feedTimeAgo(feedParseTime(m.created_at)));
    return '<div class="feed-msg">'
      +   '<div class="feed-msg-head"><span class="feed-msg-author">'+escapeHtml(m.author_name)+'</span>'
      +     '<span class="feed-msg-when">'+when+'</span></div>'
      +   '<div class="feed-msg-body">'+escapeHtml(m.body)+'</div>'
      + '</div>';
  }).join('');
  host.scrollTop = host.scrollHeight; // keep newest in view
}
```

- [ ] **Step 3: Add the compose row (signed-in vs signed-out) + send**

Insert after `renderMessages`:
```js
// Render the compose row: input+send when signed in, a sign-in CTA otherwise.
function renderCompose(){
  var host = document.getElementById('feed-compose');
  if(!host) return;
  if(currentUser){
    host.className = 'feed-compose';
    host.innerHTML = '<input id="feed-msg-input" type="text" maxlength="280" placeholder="Message the community…" '
      + 'oninput="syncSendBtn()" onkeydown="if(event.key===\'Enter\')sendMessage()" />'
      + '<button type="button" class="btn-send" id="feed-msg-send" onclick="sendMessage()" disabled>Send</button>';
  } else {
    host.className = 'feed-signin-cta';
    host.innerHTML = 'Sign in to post. <a onclick="openSignIn(\'signin\')">Sign in</a>';
  }
}

function syncSendBtn(){
  var input = document.getElementById('feed-msg-input');
  var btn = document.getElementById('feed-msg-send');
  if(input && btn) btn.disabled = input.value.trim().length === 0;
}

function sendMessage(){
  var input = document.getElementById('feed-msg-input');
  var btn = document.getElementById('feed-msg-send');
  if(!input) return;
  var text = input.value.trim();
  if(!text) return;
  if(btn) btn.disabled = true;
  apiFetch('/api/community/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: text })
  })
  .then(function(){ input.value = ''; return refreshMessages(true); })
  .catch(function(err){
    if(btn) btn.disabled = false;
    alert('Could not send: ' + (err.message || 'try again'));
  });
}
```

- [ ] **Step 4: Make open / interval / visibility refresh the ACTIVE tab**

In `openCommunityFeed()`, change the open branch from `refreshFeedData(false);` to `refreshActiveTab(false);`. The function becomes:
```js
function openCommunityFeed(){
  feedPanelOpen = !feedPanelOpen;
  if(feedPanelOpen){
    if(!feedGeoAsked) requestUserLocation();
    refreshActiveTab(false);
    startFeedAutoRefresh();
  } else {
    stopFeedAutoRefresh();
  }
  updateFeedFab();
}
```

In `startFeedAutoRefresh()`, change the interval tick from `refreshFeedData(true)` to `refreshActiveTab(true)`:
```js
  feedTimer = setInterval(function(){
    if(feedPanelOpen && document.visibilityState === 'visible') refreshActiveTab(true);
    else stopFeedAutoRefresh();
  }, 60000);
```

In the `visibilitychange` listener, change `refreshFeedData(true)` to `refreshActiveTab(true)`:
```js
  if(document.visibilityState === 'visible'){
    if(feedPanelOpen){ refreshActiveTab(true); startFeedAutoRefresh(); }
  } else {
    stopFeedAutoRefresh();
  }
```

- [ ] **Step 5: Verify no curly quotes + JS parses**

Run:
```bash
python3 -c "
b=open('mockups/civicdoodies.html','rb').read()
bad=[m for m in [b'\xe2\x80\x98',b'\xe2\x80\x99',b'\xe2\x80\x9c',b'\xe2\x80\x9d'] if m in b]
print('CURLY QUOTES FOUND' if bad else 'clean: no curly quotes')
"
node --check <(sed -n '/<script>/,/<\/script>/p' mockups/civicdoodies.html | sed '1d;$d') 2>&1 | head -3 && echo "parse: clean"
```
Expected: `clean: no curly quotes` and `parse: clean`.

- [ ] **Step 6: Commit**

```bash
git add mockups/civicdoodies.html
git commit -m "feat(mockup): wire Community tab — list, compose, send, tab-aware refresh"
```

---

## Task 6: End-to-end manual verification

No code — confirms the full feature in a browser. Serve the mockup over http on localhost (so the session cookie is sent), with `wrangler dev` running.

- [ ] **Step 1: Apply migration + start the Worker + serve the mockup**

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --file migrations/0012_community_messages.sql  # if not already applied
npx wrangler dev            # terminal 1
cd mockups && python3 -m http.server 5050   # terminal 2 -> http://localhost:5050/civicdoodies.html
```

- [ ] **Step 2: Signed-out behavior**

Open the panel → click the **Community** tab. Expected: message list loads (or "No messages yet — say hello."), and the compose area shows **"Sign in to post"** (no input box).

- [ ] **Step 3: Post a message**

Sign in (or create an account). On the Community tab, type a message and press Send. Expected: input clears, the message appears at the bottom with your username + "just now".

- [ ] **Step 4: Banned word is censored**

Send a message containing a banned word (e.g. "oh damn"). Expected: it appears as "oh ****". Confirm the flag is recorded:
```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --command "SELECT author_name, body, flagged FROM community_message ORDER BY created_at DESC LIMIT 3;"
```
Expected: the censored row has `flagged = 1`.

- [ ] **Step 5: Persistence + tabs**

Reload the page, open the panel, Community tab → your messages are still there. Switch back to **Reports** → the report list + filters return unchanged.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `community_message` table (id, user_id, author_name, body, flagged, created_at) | Task 1 |
| Body stored already-censored; `flagged` audit hook | Task 1 + Task 3 (POST stores censored + flag) |
| `banned-words.ts` list + `censor()` (whole-word, case-insensitive, `****`) | Task 2 |
| `GET /api/community/messages?limit` public, recent, oldest-first | Task 3 Step 1 |
| `POST /api/community/messages` requires sign-in, 280 cap, censors, author=username | Task 3 Step 1 |
| Mount + OpenAPI schema | Task 3 Steps 2-3 |
| Reports/Community tab in panel | Task 4 + Task 5 Step 1 |
| Message list (author · time · body) | Task 5 Step 2 |
| Compose box; signed-out → "Sign in to post" | Task 5 Step 3 |
| Reuse 60s auto-refresh for the active tab | Task 5 Step 4 |
| Loading/error/empty states | Task 5 Step 2 (spinner/Retry/empty) |
| Banned word → censored not blocked | Task 2 + Task 6 Step 4 |
| Persistence | Task 1/3 + Task 6 Step 5 |

**Placeholder scan:** No TBDs; every code step has complete code; curl/manual steps have exact commands + expected output.

**Type consistency:** Message shape `{ id, author_name, body, flagged:boolean, created_at }` is identical across `toMessage()` (Task 3), the `CommunityMessage` schema (Task 3), and `renderMessages()` (Task 5). `censor()` returns `{ body, flagged }` in Task 2 and is consumed that way in Task 3. `feedTab` is `'reports'|'community'` in Tasks 4-5. `refreshActiveTab(silent)` defined in Task 5 Step 1 and called in Steps 4. `currentUser` (existing) gates the compose row.

**Note on testing:** Only `censor()` is unit-tested (vitest) because the project has no D1/Workers test harness; routes + mockup are verified via curl + manual browser steps, consistent with the rest of the codebase.
