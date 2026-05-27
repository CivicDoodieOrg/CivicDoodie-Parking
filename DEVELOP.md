# Developing CivicDoodie Parking

Companion to [README.md](README.md) (product spec) and [docs/implementation-plan.md](docs/implementation-plan.md) (phased build progress).

## Local setup

```bash
git clone https://github.com/CivicDoodieOrg/CivicDoodie-Parking
cd CivicDoodie-Parking
npm install
npm install --prefix web            # install frontend dependencies
cp .dev.vars.example .dev.vars      # edit if you want real OAuth locally
npm run migrate:local
npm run dev          # terminal 1 — Worker backend on :8787
npm run dev:web      # terminal 2 — Vite dev server on :5173 (proxies /api → :8787)
```

Open <http://localhost:5173>. The placeholder values in `.dev.vars` are enough to boot the auth handler — you only need real Google/Facebook credentials if you want to complete an OAuth round-trip locally. Most backend exercises can be done with a planted bearer token (see below).

## Daily commands

| Command | What it does |
|---|---|
| `npm run dev` | Worker backend with hot reload (Miniflare) |
| `npm run dev:web` | Vite dev server with HMR |
| `npm run preflight` | Build frontend + typecheck backend — **must be green before push** |
| `npm run check:web` | Svelte-check (Svelte-aware type check) |
| `npm run typecheck` | Backend `tsc --noEmit` |
| `npm run migrate:local` | Apply migrations to local D1 |
| `npm test` | Vitest |

## Pre-push smoke tests

Run, in order:

1. **`npm run preflight`** — CI runs the same thing. Fails here ⇒ fails in CI. Must be clean.
2. **`npm run check:web`** — Svelte-specific issues. Not a CI gate, but catches regressions early.
3. **Boot the dev servers** and exercise whatever path you touched. The matrix below covers the common cases.

### What to click through (browser, after `dev` + `dev:web`)

| Changed | Verify |
|---|---|
| **SPA routing / `wrangler.json`** | `/` loads. **`/profile` and `/onboarding` load fresh** (not 404 — proves the `ASSETS` SPA fallback is wired). |
| **Auth / `src/auth.ts`** | Sign-in button starts an OAuth flow and redirects to a real provider URL (only completes if real creds are in `.dev.vars`). |
| **Onboarding** | Null your screen_name (see below), refresh, you should land on `/onboarding`. Suggestion is `adj-noun-num`, never your OAuth name. "Try another" rerolls. Live availability flips green/red as you type. Acknowledge checkbox + valid name enables submit. After submit, lands on `/profile`. |
| **Profile page** | Public section: screen name, Brownie Points, location, joined. Private section: display name (from OAuth), email, account ID, status, ToS, linked providers. Sign out clears state and returns to `/`. |
| **API spec** | `http://localhost:8787/api/docs` renders (Scalar UI), 22 paths grouped by tag. |

### Reset your screen_name to retest onboarding

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local \
  --command="UPDATE \"user\" SET screen_name = NULL WHERE email = 'YOU@example.com';"
```

### Backend smoke tests (curl, no OAuth needed)

`bearer()` is configured on better-auth, so a session token in `Authorization: Bearer …` works on every protected endpoint. Plant a test user + session:

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --command="
INSERT INTO \"user\" (id, name, email, screen_name, country, terms_accepted_at)
  VALUES ('test-jane', 'Jane', 'jane@local.test', 'JaneTester', 'US', datetime('now'));
INSERT INTO \"session\" (id, expiresAt, token, userId)
  VALUES ('test-sess', datetime('now', '+1 day'), 'test-token-12345', 'test-jane');
"
```

Then:

```bash
TOKEN="Authorization: Bearer test-token-12345"

curl -s http://localhost:8787/api/health
curl -s http://localhost:8787/api/towns | head -c 200
curl -s -H "$TOKEN" http://localhost:8787/api/profile

# File a Doodie with one image
curl -s -X POST -H "$TOKEN" \
  -F "type=meter" -F "description=test report" \
  -F "images=@/path/to/some.jpg" \
  http://localhost:8787/api/towns/boston-ma/doodies
```

Clean up:

```bash
npx wrangler d1 execute civicdoodie-parking-db-local --local --command="
DELETE FROM doodie WHERE reporter_id='test-jane';
DELETE FROM \"session\" WHERE userId='test-jane';
DELETE FROM \"user\" WHERE id='test-jane';
"
```

To exercise admin endpoints, temporarily set `ADMIN_USER_IDS=test-jane` in `.dev.vars` and restart `npm run dev` (wrangler reads vars on boot). Revert after.

## Database

Local D1 lives in `.wrangler/state/v3/d1/`. To reset:

```bash
rm -rf .wrangler/state && npm run migrate:local
```

Common queries:

```bash
# List tables
npx wrangler d1 execute civicdoodie-parking-db-local --local \
  --command="SELECT name FROM sqlite_master WHERE type='table';"

# Inspect users (note: "user" is a SQL reserved word, must be quoted)
npx wrangler d1 execute civicdoodie-parking-db-local --local \
  --command="SELECT id, screen_name, status, brownie_points FROM \"user\";"
```

## Project layout

```
src/
├── index.ts                Hono entry — middleware chain, route mounting, OpenAPI registration
├── auth.ts                 better-auth setup (Google + Facebook OAuth)
├── schemas.ts              Zod schemas — used by OpenAPI declarations
├── openapi-routes.ts       Declarative route definitions for the API spec
├── lib/
│   ├── slug.ts             generateSlug, sanitizeScreenName, validateScreenName
│   ├── name-generator.ts   Random adj-noun-num screen-name suggestions
│   └── r2.ts               Image upload helpers (validate, store, delete)
├── middleware/
│   ├── auth.ts             requireAuth (session lookup + ban check)
│   ├── admin.ts            requireAdmin (404 to non-admins so endpoints don't leak)
│   └── rate-limit.ts       In-memory sliding-window per route
└── routes/
    ├── profile.ts          /api/profile — get, patch, screen-name flow, accept-terms
    ├── towns.ts            /api/towns — list, get
    ├── doodies.ts          /api/towns/:slug/doodies — CRUD, vote, report, image serve
    ├── comments.ts         /api/comments + nested under doodies
    ├── dashboard.ts        /api/towns/:slug/dashboard/map
    └── admin.ts            /api/admin — reports queue, user moderation

web/
├── index.html, vite.config.ts, svelte.config.js, tsconfig.json
└── src/
    ├── App.svelte          Hand-rolled router + shell
    ├── main.ts             Mount point
    ├── app.css             Global styles + CSS variables
    ├── lib/                api wrapper, reactive auth state, types
    └── pages/              Landing, Onboarding, Profile

migrations/                 D1 SQL files, applied in numeric order
docs/                       Specs and plans
scripts/build-wrangler-deploy.mjs    Generates wrangler.deploy.json at deploy time
```

## Common gotchas

- **`/profile` 404s in browser** — `wrangler.json` is missing `assets.binding: "ASSETS"`, or the `notFound` handler in `src/index.ts` isn't delegating non-`/api/*` paths to `c.env.ASSETS.fetch(c.req.raw)`.
- **`npm ci` fails but `npm install` succeeds** — lockfile drift. Regenerate: `cd web && rm -rf node_modules package-lock.json && npm install`.
- **Screen name "already in use" with different case** — uniqueness is case-insensitive (`UNIQUE COLLATE NOCASE`). `Foo` and `foo` are the same name.
- **Multipart upload tests fail** — use `curl -F` (multipart), not `-d` (urlencoded).
- **Dev server ignores new env vars** — wrangler reads `.dev.vars` once on boot. Restart `npm run dev` after edits.
- **Migration won't apply** — wrangler tracks applied migrations in a `d1_migrations` table. To force-replay everything, `rm -rf .wrangler/state && npm run migrate:local`.

## CI

`.github/workflows/deploy.yml` runs on push to `main` and on `v*` tags:

- **`preflight`** — `npm ci` (root + `web/`) + `npm run preflight`. Blocks every deploy.
- **`deploy-staging`** — runs on `main`. Generates `wrangler.deploy.json` from GitHub Secrets, then `wrangler deploy --env staging`.
- **`deploy-production`** — runs on `v*` tags. Same flow, `--env prod`.

GitHub Secrets needed: `CLOUDFLARE_API_TOKEN`, `STAGING_D1_DATABASE_ID`, `PROD_D1_DATABASE_ID`.

## Deploys

Both `npm run deploy:staging` and `npm run deploy:prod` need the two D1 UUIDs in your shell:

```bash
export STAGING_D1_DATABASE_ID=...
export PROD_D1_DATABASE_ID=...
```

The committed `wrangler.json` is local-dev only — IDs aren't in the repo. The deploy script generates `wrangler.deploy.json` (gitignored) from these env vars. See [scripts/build-wrangler-deploy.mjs](scripts/build-wrangler-deploy.mjs).

**Don't deploy without applying migrations to the target environment first** (`npm run migrate:staging`, `npm run migrate:prod`).

## Branch previews

Any push to a branch named `web-*` is automatically deployed to `https://<slug>.preview.civicdoodie.org`, where `<slug>` is the branch name lowercased, with `/` and `_` replaced by `-`, characters outside `[a-z0-9-]` stripped, and truncated to 35 chars.

### What gets deployed

- A per-branch Cloudflare Worker named `civicdoodie-parking-preview-<slug>`, bound to **staging's** D1 database and R2 bucket. Preview data is staging data — anything you write on a preview is visible on staging and vice versa.
- Sign-in is handled by a permanent Worker at `auth.preview.civicdoodie.org`. The preview Worker holds `BETTER_AUTH_SECRET` (same value as the auth Worker) so it can validate sessions, but does **not** hold Google or Facebook OAuth secrets.

### Smoke checklist (after a preview deploys)

1. Open `https://<slug>.preview.civicdoodie.org` — the SPA shell loads.
2. Click "Sign in with Google". You should land on Google's consent screen, then be redirected back to `https://<slug>.preview.civicdoodie.org/profile`.
3. DevTools → Application → Cookies: the Better Auth session cookie's `Domain` is `.preview.civicdoodie.org` (note the leading dot).
4. `GET /api/profile` on the preview origin returns the signed-in user.

### Cross-preview session caveat

Because all previews share the `.preview.civicdoodie.org` cookie scope and the same staging session table, **signing in on one preview signs you in on all of them**. Signing out on any preview signs you out everywhere. Don't assume previews are session-isolated when comparing behavior across two `web-*` branches in the same browser profile — use a separate profile or incognito window.

### Trust boundary

The preview workflow triggers only on `push` to branches in this repository, so fork PRs can never spin up a preview Worker. Anyone with push access to this repo, however, can deploy arbitrary code that reads/writes staging's D1 and R2. Keep PII out of staging accordingly.

### Cleanup

Preview Workers are deleted automatically when their branch is deleted on the remote (via the `delete` event). A daily GC workflow (`preview-gc.yml`, 04:17 UTC) sweeps any orphans whose branch has gone away without firing the event.

### Triggering a redeploy

Push another commit to the `web-*` branch. The preview URL is stable.

## Where things live

- **Product spec** — [README.md](README.md)
- **Phased build plan + progress** — [docs/implementation-plan.md](docs/implementation-plan.md)
- **Agent guidance** (AI assistants) — [AGENTS.md](AGENTS.md)
- **API reference** — `npm run dev` then open <http://localhost:8787/api/docs>
