# AGENTS.md

Guidance for AI agents (Claude Code, Codex, Copilot, etc.) working in this repo. Human contributors: see [README.md](README.md).

## What this project is

CivicDoodie-Parking is a civic-crowdsourcing web app for reporting parking-meter, garage, and enforcement issues ("Doodies") scoped by municipality ("town"). Auth'd users submit reports with images, comment, and upvote/downvote; a public dashboard surfaces recent and top-voted items. See [README.md § Prompt Zero](README.md) for the full domain model.

**Status:** scaffolding. As of this writing, only README and LICENSE exist — no source code, package.json, migrations, or config yet. Treat the README as the spec; do not assume any file or command in it already exists. Verify with `ls` / `git log` before referencing.

## Tech stack (intended)

- **Frontend:** Svelte 5 + Vite SPA in `web/`
- **Backend:** Hono on Cloudflare Workers in `src/`
- **Storage:** Cloudflare D1 (SQLite) + R2 (objects)
- **Auth:** better-auth — email/password, Google, Facebook
- **DB access:** Kysely (type-safe query builder, no ORM)
- **Migrations:** D1 SQL files in `migrations/`

Stick to this stack unless the user explicitly asks otherwise. Don't introduce Prisma, Drizzle, Express, Next.js, etc.

## Domain vocabulary

Use these names consistently in code, types, tables, and routes — they're load-bearing for the product:

- **Doodie** — a reported issue (not "report", "incident", "issue")
- **Town** — the municipality scope (not "city", "municipality")
- **Brownie Points** — user karma (display name; internal field can be `karma`)
- **Reporter** — the user who filed a Doodie

Doodie types: `enforcement`, `meter`, `garage`. Max 4 images per Doodie.

## Conventions

- **TypeScript everywhere.** No plain `.js` in `src/` or `web/src/`.
- **Type-safe DB.** Use Kysely; no raw string SQL in route handlers (migrations excepted).
- **Zod at the edges.** Validate request bodies with Zod schemas in `src/schemas.ts`; reuse them for OpenAPI route definitions.
- **Auth middleware.** Protected routes go through `requireAuth` from `src/middleware/auth.ts`. Don't reimplement session lookup inline.
- **Privacy:** never expose user email in API responses. Screen name + city (optional) + state/country (required) only.
- **IP addresses** are stored on Doodies and comments for accountability — treat as PII, never return in public API responses.
- **Audit log** every Doodie state change (create, edit, delete, censor). Don't bypass it for "small" edits.

## Commands

These are defined in README but **may not exist yet** — check `package.json` first:

```bash
npm run dev              # Worker backend (Miniflare, :8787)
npm run dev:web          # Svelte dev server (:5173)
npm run preflight        # Frontend build + backend typecheck — run before claiming done
npm run typecheck        # Backend TS check
npm run check:web        # Svelte type check
npm test                 # Tests
npm run migrate:local    # Apply D1 migrations to local SQLite
```

**Before reporting a task complete:** run `npm run preflight` (once it exists). For UI changes, also exercise the feature in the browser at `http://localhost:5173`.

## Deploys (do not run without explicit user request)

`npm run deploy:staging` and `npm run deploy:prod` push to Cloudflare. Never run these on your own — they affect shared infrastructure. Same for `npm run migrate:staging` / `migrate:prod`. CI handles staging on push to `main` and prod on `v*` tags.

## Local dev secrets

Secrets live in `.dev.vars` (gitignored). If it's missing, ask the user — don't generate placeholder values into a committed file.

## Things to avoid

- Don't add an ORM, server framework, or build tool not listed above.
- Don't create new top-level directories without checking the README's project structure.
- Don't write docs (`*.md`) unless asked. README is the spec; AGENTS.md is this file. Anything else needs a reason.
- Don't commit `.wrangler/state/`, `.dev.vars`, `node_modules/`, or generated `public/` build output.
- Don't bypass the audit log, `requireAuth`, or Zod validation to "simplify" a handler.

## When in doubt

The README is the source of truth for product intent. If something here conflicts with README, README wins — and tell the user so this file can be updated.
