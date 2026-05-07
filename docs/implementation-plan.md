# CivicDoodie-Parking — Implementation Plan

Living doc. Update phase status as work lands; let `git log -- docs/implementation-plan.md` tell the history.

## Decisions locked in

- **Auth:** Google + Facebook OAuth. Email/password deferred (extra surface — verification emails, reset flow, transactional email provider).
- **Towns:** Predefined seed list (~50 US municipalities), expandable via admin.
- **Map library:** MapLibre GL + free OSM/Carto tiles.
- **Dropped from wethinkt-share clone:** Polar billing, CLI device-auth, Collections model.
- **Kept (deferred):** i18n (Lingui) — temporarily removed from web/package.json to fix CI peer-dep conflict; re-add when actually used.

## Open questions (revisit when each phase needs them)

- Transactional email provider (only matters when email/password lands)
- Brownie Points ledger rules (+/- per action)
- Auto-approve Doodies vs. manual queue (likely auto for users in good standing, queue for new accounts + reported items)

## Phases

### Phase 0 — Scaffolding ✅ done (commit `dbe0358`)
- Backend stub (Hono + OpenAPI shell + /api/health)
- Svelte 5 SPA stub
- wrangler.json, tsconfig, package.json, .gitignore, CI workflow
- Preflight green

### Phase 1 — Auth foundation ✅ done (commit `d83960e`)
- Migration `0001_init.sql`: better-auth tables + civicdoodie user extensions (screen_name, city, state_or_region, country, brownie_points, status, terms_accepted_at)
- `src/auth.ts`: Google + Facebook OAuth, account linking, screen_name auto-gen with collision retry
- `src/middleware/auth.ts`: requireAuth + ban/suspend check
- `src/lib/slug.ts`: generateSlug + sanitizeScreenName
- `src/routes/profile.ts`: GET / PATCH / accept-terms
- Frontend: reactive `$state` auth store, typed API wrapper, hand-rolled router (`/`, `/profile`), Landing + Profile pages
- `.dev.vars.example`

### Phase 1 wire-up — Staging & Production 🟡 in progress
- Wire-up plan lives outside the repo (private; covers Cloudflare provisioning + OAuth app creation + secrets).
- Status: Google OAuth working on `parking-staging.civicdoodie.org`; SPA fallback fix landed (commit `e094c8f`); needs Facebook smoke test + prod deploy + admin bootstrap.

### Phase 2 — Town + Doodie data model ✅ done (commit `c45cc47`)
- Migration `0002_towns.sql`: town entity + 52 seeded US municipalities
- Migration `0003_doodies.sql`: doodie, doodie_image (max 4), doodie_vote, doodie_comment, doodie_comment_vote, doodie_audit (append-only), report (polymorphic doodie|comment)
- 14 indexes for dashboard queries planned for Phase 3
- FK + CHECK constraints verified locally; cascade delete works

### Phase 3 — Core API ⏳ next (~5–6 hr, ~12 files)
Backend routes + middleware + utilities. End state: every endpoint in the README's planned API table works via curl; `/api/docs` shows them all.

- `src/routes/towns.ts` — list towns, get town
- `src/routes/doodies.ts` — POST/GET/PATCH/DELETE, vote, report (multipart for image upload)
- `src/routes/comments.ts` — CRUD, vote, report
- `src/routes/dashboard.ts` — recent / top / map-data tabs
- `src/routes/admin.ts` + `admin-api.ts` — moderation queue (server-rendered)
- `src/middleware/admin.ts` — hardcoded ADMIN_USER_IDS check
- `src/middleware/rate-limit.ts` — sliding-window per-route, port from wethinkt-share
- `src/lib/r2.ts` — image upload helper (validate MIME, cap 5 MB, key under doodies/{id}/{position}.{ext})
- `src/lib/karma.ts` — Brownie Points ledger
- `src/schemas.ts` — Zod schemas
- `src/openapi-routes.ts` — declarative OpenAPI definitions
- Audit log writes inline in handlers (no middleware)

### Phase 4 — Frontend ⏳ pending (~6–8 hr)
- Routing in `App.svelte`: `/`, `/town/:townSlug`, `/town/:townSlug/report`, `/town/:townSlug/d/:doodieSlug`, `/u/:screenName`, `/profile`, `/privacy`, `/terms`
- Pages: Landing (login + town selector), TownDashboard (3 tabs: recent / top / map), ReportDoodie (form + image dropzone), DoodieView, UserProfile
- Components: TopBar, TownPicker, DoodieCard, DoodieMap (lazy-loads MapLibre + clustering), ImageDropzone, VoteButtons, CommentList, ReportButton, ToSBanner
- Map view: MapLibre GL + supercluster source for pin density
- i18n scaffold (English-only initially, defer translations) — re-add lingui carefully to avoid the picomatch conflict

### Phase 5 — Moderation & Polish ⏳ pending (~3 hr)
- Approval workflow decision: auto for active users, manual queue for new accounts + reported items
- Admin dashboard: report queue, audit log viewer, ban/unban, brownie-points adjust, comment censor
- Brownie Points award triggers wired in
- Privacy + Terms pages, About modal
- PII audit: confirm no endpoint leaks email or ip_address to non-admins

### Phase 6 — Deploy / CI completion ⏳ partly done
Most of this overlaps with Phase 1 wire-up:
- Cloudflare D1 + R2 buckets staging + prod ✅
- GitHub Secrets (CLOUDFLARE_API_TOKEN, STAGING_D1_DATABASE_ID, PROD_D1_DATABASE_ID) — staging working, prod TBD
- OAuth apps for staging + prod — Google staging ✅, Facebook + prod TBD
- First deploy via push to main ✅ (staging green)
- Tag v0.1.0 → prod deploys — TBD

## What's been added beyond the original plan

- **OSS hygiene config split** (commit `d07aaa8`): `wrangler.json` committed lean (local-dev only); `scripts/build-wrangler-deploy.mjs` synthesizes gitignored `wrangler.deploy.json` from `STAGING_D1_DATABASE_ID` + `PROD_D1_DATABASE_ID` env vars.
- **CI fix** (commit `f23d1a9`): dropped unused `@lingui/*` deps to resolve picomatch peer-dep conflict that broke `npm ci` on stricter CI npm.
- **Node 24 in CI** (commit `229c885`).
- **SPA fallback fix** (commit `e094c8f`): `ASSETS` binding + `app.notFound` delegation so `/profile` (and other SPA paths) return `index.html` after a fresh page load.

## Estimate to v0.1

Roughly 14–17 hours of focused work across Phases 3–5, plus the Phase 1 wire-up tail (Facebook OAuth + prod deploy + admin bootstrap). Phase 3 is the biggest single chunk.
