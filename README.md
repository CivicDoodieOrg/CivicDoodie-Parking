# Civic Doodie - Parking

https://github.com/CivicDoodieOrg/CivicDoodie-Parking

## Prompt Zero

If you look at https://civicdoodie.org you will see a mock landing page of a civic crowdsourcing site.   This is the Parking web application, focusing mostly on meters.

This app will allow users to report parking meter and a public dashboard to monitor the state.

Users must by authenticated to report or to comment/upvote/downvote.  They can auth with email/password, Google, or Facebookl; we use BetterAuth to support this.  Users have karma and can be banned; Karma is called "Brownie Points".   We track IP address for accountability.  They have a screen name for privacy, but their city (if they want) and their state/country (mandatory).  Emails are hidden.

Data is scoped by municipality, called "town" internally; this is the city / town / village / county involved.   Once they enter a data scope, they can view its dashboard or report an issue.

Issues are called a Doodies.   A Doodie has:
 * town
 * type (enforcement, meter, garage)
 * a set of images (limit to 4)
 * description
 * related to disability
 * reporter
 * approved

A Doodie also has an audit log, when/who it was created, deleted, edited, censored, etc.
A Doodie has upvotes and downvotes (tallied distinctly)
A Doodie has comments, which has a user, their IP address, the time, upvote, downvote, report(censor)

The dashboard allows to users to see the most recently submitted items, the most voted items, and a map view.

The report mode allows users to report an incident.   

The rest of the document covers project structure.

## Tech Stack

- [Svelte 5](https://svelte.dev) + [Vite](https://vite.dev) — Frontend SPA
- [Hono](https://hono.dev) — Backend API framework
- [Cloudflare Workers](https://workers.cloudflare.com) — Serverless runtime
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite database
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — Object storage for session data
- [better-auth](https://www.better-auth.com) — Authentication (GitHub & Google OAuth)
- [Kysely](https://kysely.dev) — Type-safe SQL query builder

## Project Structure

```
web/                          # Svelte + Vite frontend (SPA)
├── src/
│   ├── App.svelte            # Router + layout shell
│   ├── main.ts               # Mount point
│   ├── app.css               # Global styles + CSS variables
│   ├── lib/
│   │   ├── api.ts            # Typed fetch wrapper for API
│   │   ├── auth.svelte.ts    # Reactive auth state
│   │   └── types.ts          # Shared TypeScript types
│   ├── components/
│   ├── pages/
│   │   ├── Landing.svelte    # Login buttons, features
│   │   ├── Privacy.svelte    # Privacy policy
src/                          # Cloudflare Worker backend (API only)
├── index.ts                  # Route mounting + OpenAPI config
├── auth.ts                   # better-auth setup
├── schemas.ts                # Zod schemas for OpenAPI
├── openapi-routes.ts         # OpenAPI route definitions
├── middleware/auth.ts         # requireAuth middleware
└── routes/
    ├── admin.ts              # Admin dashboard (server-rendered)
    ├── admin-api.ts          # Admin moderation API
    ├── terms.ts              # Terms of Service
    ├── users.ts              # Public user profiles + user-scoped access
    └── sessions.ts           # Session CRUD + tags/likes/views
migrations/                   # D1 database migrations
docs/                         # Specs and plans
```

## Development

### Quick start

```bash
npm install
cd web && npm install && cd ..
npm run dev:web    # Svelte dev server at http://localhost:5173 (hot reload)
npm run dev        # Worker backend at http://localhost:8787
```

Run both for full-stack local development. The Vite dev server proxies `/api` requests to the Worker backend.

Alternatively, build the frontend and serve everything from the Worker:

```bash
npm run build:web && npm run dev
```

### Local environment

`wrangler dev` runs the backend locally using [Miniflare](https://miniflare.dev) — no Docker or containers needed. It emulates:

- **D1** — local SQLite database (stored in `.wrangler/state/v3/d1/`)
- **R2** — local file-backed object storage (stored in `.wrangler/state/v3/r2/`)
- **Workers runtime** — same V8 isolate environment as production

#### 1. Create `.dev.vars`

Secrets are loaded from `.dev.vars` (gitignored) in the project root:

```
GOOGLE_CLIENT_ID=your-dev-google-id
GOOGLE_CLIENT_SECRET=your-dev-google-secret
GOOGLE_CLI_CLIENT_ID=your-dev-google-cli-id
GOOGLE_CLI_CLIENT_SECRET=your-dev-google-cli-secret
BETTER_AUTH_SECRET=dev-secret-at-least-32-characters-long-here
BETTER_AUTH_URL=http://localhost:8787
```

#### 2. Apply migrations locally

```bash
npm run migrate:local
```

This creates the tables in your local D1 database. Run this again whenever new migrations are added.

#### 3. OAuth callback URLs

OAuth providers need to redirect back to your local server. You have two options:

**Option A: Separate dev OAuth apps** (recommended) — Create a second GitHub OAuth app and Google OAuth app with `http://localhost:8787` as the callback URL. Use those credentials in `.dev.vars`.

**Option B: Temporarily update existing apps** — Change the callback URL on your existing GitHub/Google OAuth apps to `http://localhost:8787`. Remember to change them back before deploying.

#### 4. Start the dev server

```bash
npm run dev:web  # Terminal 1: Svelte dev server (port 5173, proxies API)
npm run dev      # Terminal 2: Worker backend (port 8787)
```

Open `http://localhost:5173` for hot-reloading frontend development. The local D1 and R2 are independent from staging/production — you can upload sessions, create tags, etc. without affecting real data.

### Commands

```bash
npm run dev              # Worker backend (Miniflare, port 8787)
npm run dev:web          # Svelte dev server (Vite, port 5173)
npm run build:web        # Build frontend to public/
npm run check:web        # Svelte type checking
npm run preflight        # Build frontend + typecheck backend
npm run typecheck        # TypeScript type checking (backend only)
npm test                 # Run tests
npm run deploy:prod      # Preflight + deploy to production
npm run deploy:staging   # Preflight + deploy to staging
npm run migrate:local    # Apply D1 migrations locally
npm run migrate:staging  # Apply D1 migrations to staging
npm run migrate:prod     # Apply D1 migrations to production
npm run generate:openapi # Snapshot OpenAPI spec to openapi.json
```

### Preflight checks

`npm run preflight` runs before every deploy (locally and in CI). It:

1. Builds the Svelte frontend (`web/` → `public/`)
2. Runs TypeScript type checking on the backend

### Resetting local state

Local D1 and R2 data lives in `.wrangler/state/`. To start fresh:

```bash
rm -rf .wrangler/state
npx wrangler d1 migrations apply DB --local
```

## API

The API contract is defined declaratively using OpenAPI. The OpenAPI specification is the **authoritative** source of truth for both backend and frontend development.

- **Spec Location**: The routes are defined in [src/openapi-routes.ts](src/openapi-routes.ts) using `@hono/zod-openapi` and schemas in [src/schemas.ts](src/schemas.ts).
- **Interactive Docs**: Run the backend locally (`npm run dev`) and visit `http://localhost:8787/api/docs` to access the Scalar interactive API reference.
- **Spec JSON**: The raw OpenAPI spec is served at `/api/openapi.json`.
- **Client Integration**: The Svelte frontend connects to the API using Hono's RPC client (`hc` from `hono/client`) instantiated inside [web/src/lib/api.ts](web/src/lib/api.ts). Because the client is cast to `any` to prevent compiler type pollution from mixed/un-typed endpoints, the strictly-typed `api` facade wrapper in [web/src/lib/api.ts](web/src/lib/api.ts) serves as the type-safe contract for page components. Always align this facade with the backend's OpenAPI definitions.

## Environments

| Environment | Domain | Deploy |
|-------------|--------|--------|
| Production | `parking.civicdoodie.org` | `npm run deploy:prod` |
| Staging | `parking-staging.civicdoodie.org` | `npm run deploy:staging` |

Each environment has its own D1 database and R2 bucket. Bare `wrangler deploy` (without `--env`) is discouraged — use the npm scripts.

### CI/CD

GitHub Actions (`.github/workflows/deploy.yml`):

- **Push to `main`** — Builds frontend, runs preflight, deploys to staging
- **Push a `v*` tag** — Builds frontend, runs preflight, deploys to production

Requires a `CLOUDFLARE_API_TOKEN` secret configured in the GitHub repository settings.

## License

This project source code is public source under a noncommercial license.  It is released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).

CivicDoodie.org, branding files, all trademarks and non-source copyrights retain all rights reserved.

Copyright (c) 2026 Neomantra Corp. See [LICENSE.txt](LICENSE.txt).
