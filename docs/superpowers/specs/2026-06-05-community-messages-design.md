# Community Messages — Design

**Date:** 2026-06-05
**Files touched:** `migrations/0012_community_messages.sql`, `src/lib/banned-words.ts`, `src/routes/community.ts`, `src/schemas.ts`, `src/index.ts`, `mockups/civicdoodies.html`

---

## Goal

Add a basic community messaging feature to the existing feed widget: one **global, app-wide** message board where **signed-in** users post short messages. Banned words are **censored** (replaced with `****`) rather than blocking the post. Because posting requires sign-in, every message is attributable to a user, and messages that tripped the banned-word filter are **flagged** — so it is clear which users send bad messages.

This is intentionally minimal: one shared stream, post + read, nothing else.

---

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Placement | One global, app-wide board (not per-report) |
| Storage | Server-persisted (Cloudflare D1 table) |
| Banned words | **Censor** (replace with `****`); do not block the post |
| Posting | **Requires sign-in** (better-auth session); reading is public |
| Attribution | Each message stores `user_id` + `author_name`; banned-word hits set `flagged = 1` |

---

## Architecture

A new `community_message` table, a small banned-words library, and a `community` route group, surfaced in the mockup as a second **tab** ("Reports" | "Community") inside the existing feed panel. The server is the single source of truth for censoring — the client only displays what the server returns.

---

## Backend

### Migration — `migrations/0012_community_messages.sql`

(Next free number: existing migrations end at `0011_user_name_fields.sql`.)

```sql
CREATE TABLE IF NOT EXISTS community_message (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,                       -- better-auth user id of the poster
  author_name TEXT NOT NULL,                       -- username snapshot at post time
  body        TEXT NOT NULL,                       -- stored ALREADY censored
  flagged     INTEGER NOT NULL DEFAULT 0,          -- 1 if it contained a banned word
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_message_created ON community_message(created_at);
```

`body` is stored already censored, so reads never expose banned words. `flagged` is the audit hook: `SELECT user_id, author_name, COUNT(*) FROM community_message WHERE flagged = 1 GROUP BY user_id` answers "who sends bad messages."

### Banned words — `src/lib/banned-words.ts`

```ts
// Lowercase banned words. Whole-word, case-insensitive matching.
// Easily extended — this is the single place to edit the list.
export const BANNED_WORDS: string[] = [
  "damn", "hell", "crap", "ass", "bastard", "bitch",
  "shit", "piss", "dick", "douche", "jackass",
  // ...extend as needed
];

// Replace each whole-word banned term (case-insensitive) with "****".
// Returns the censored text and whether anything was censored.
export function censor(text: string): { body: string; flagged: boolean } {
  let flagged = false;
  const escaped = BANNED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  const body = text.replace(re, () => { flagged = true; return "****"; });
  return { body, flagged };
}
```

Word-boundary matching avoids the "Scunthorpe problem" (substrings inside clean words are not censored). Replacement is a fixed `****` for simplicity (not length-matched).

### Routes — `src/routes/community.ts`

Mounted at `/api/community` in `src/index.ts` (`.route("/api/community", community)`), so it is covered by the existing `/api/*` rate-limit and CORS middleware.

- **`GET /api/community/messages?limit=50`** — public. Returns the most recent messages in **chronological order** (oldest → newest, chat style), capped at `limit` (default 50, max 100).
  ```json
  { "messages": [ { "id": "...", "author_name": "sam_r", "body": "hi there",
                    "flagged": false, "created_at": "2026-06-05 17:00:00" } ] }
  ```
  Implemented as `SELECT ... ORDER BY created_at DESC LIMIT ?` then reversed, so the newest N are returned oldest-first.

- **`POST /api/community/messages`** — `requireAuth`. Body `{ "body": string }`.
  1. Trim; reject if empty or `> 280` chars → `400`.
  2. `censor(body)` → `{ body, flagged }`.
  3. Look up the poster's `username` (fallback to `name`) from the `user` row → `author_name`.
  4. Insert `(id, user_id, author_name, body, flagged)` with a generated id.
  5. Return `{ "message": { id, author_name, body, flagged, created_at } }`.

### Schema — `src/schemas.ts`

Add a `CommunityMessage` zod object (for OpenAPI docs) mirroring the GET response shape.

---

## Frontend (mockup — `mockups/civicdoodies.html`)

The feed panel gains a tab toggle directly under the header.

- **State:** `feedTab` = `'reports'` | `'community'` (module var, defaults `'reports'`).
- **Reports tab:** unchanged — filters, scope chip, report list.
- **Community tab:**
  - Hide the filter chips + scope chip (the board is global, not location-scoped).
  - **Message list** (`#feed-msg-list`): scrollable; each row shows `author_name` (emphasized) · relative time (`feedTimeAgo`) · body. Censored bodies arrive as `****` from the server, so no client-side filtering is needed.
  - **Compose row** pinned at the bottom: a text input (`maxlength=280`) + **Send** button.
    - **Signed in:** Send → `POST /api/community/messages` → clear input → refresh list.
    - **Not signed in:** the compose row is replaced by a "Sign in to post" link that opens the existing sign-in modal (`openSignIn('signin')`). Reading still works.
- **States:** reuse the existing patterns — spinner while loading, error + Retry on fetch failure, empty state ("No messages yet — say hello.").
- **Auto-refresh:** the existing 60s interval (panel open + tab visible) refreshes the **active tab**: reports → `/api/map`, community → `/api/community/messages`.

---

## Data Flow

1. Open panel → load the active tab's data.
2. Switch to **Community** → `GET /api/community/messages` → render the list.
3. Type a message + **Send** → `POST` → server censors + flags + stores → returns the censored message → list refreshes (banned words appear as `****`).
4. 60s poll (while panel open + visible) refreshes whichever tab is active.

---

## Error Handling

| Case | Behavior |
|---|---|
| POST while signed out | `401` → frontend shows the "Sign in to post" prompt |
| Empty / whitespace body | `400`; Send is also disabled client-side when the input is empty |
| Body > 280 chars | `400`; `maxlength=280` prevents it client-side |
| Banned word present | Censored to `****`, posted, `flagged = 1` (never rejected) |
| `GET`/`POST` network failure | Error state with a Retry action (same pattern as the report list) |
| Excessive posting | Bounded by the existing `/api/*` rate-limit middleware |

---

## Out of Scope (YAGNI)

Replies/threads, edit/delete, reactions/votes, per-report messages, location scoping of messages, websockets/real-time (the 60s poll suffices), showing the original pre-censor text, and a dedicated admin moderation UI (the `flagged` column is the hook for that later).

---

## Testing

- **`censor()` unit tests:** a banned word is replaced with `****` and `flagged === true`; clean text is unchanged and `flagged === false`; whole-word boundary holds (a banned word as a substring of a clean word is NOT censored); case-insensitive.
- **Route tests:** `POST` without a session → `401`; valid `POST` stores the censored body and correct `author_name`; `GET` returns recent messages oldest-first; over-length body → `400`.
- **Manual:** post a message containing a banned word → it shows as `****`; signed-out compose shows the sign-in prompt; messages persist across reload; `flagged` rows are queryable by `user_id`.
