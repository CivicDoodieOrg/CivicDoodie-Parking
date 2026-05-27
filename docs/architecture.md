# CivicDoodie Parking — Architecture

> Walkthrough for new contributors. Pairs with [README.md](../README.md) (product spec) and [DEVELOP.md](../DEVELOP.md) (daily commands).

## 1. The one-liner

A **crowdsourced parking-issue tracker**, scoped by municipality ("town"). Users sign in, file **Doodies** (meter / garage / enforcement reports) with photos, then comment + vote. Admins moderate. Everything ships on **Cloudflare's edge**.

## 2. The big picture

```mermaid
flowchart TB
    Browser["Browser (user)<br/><i>Svelte 5 SPA — Vite build,<br/>hand-rolled router, reactive auth state</i>"]

    subgraph Worker["Cloudflare Worker — parking.civicdoodie.org (one deployable)"]
        direction TB
        Hono["<b>Hono app</b> (src/index.ts)<br/>rate-limit middleware on /api/*<br/>/api/auth/* → better-auth<br/>/api/* → route modules<br/>/api/docs → Scalar (OpenAPI UI)<br/>else → ASSETS (SPA fallback)"]
    end

    D1[("D1 — SQLite at the edge<br/>users, towns, doodies,<br/>comments, votes, audit_log")]
    R2[("R2 — object storage<br/>Doodie images (≤4 per report)")]
    Assets["ASSETS binding<br/>static SPA build (web/dist)"]
    OAuth(["OAuth providers<br/>Google · Facebook"])

    Browser -- HTTPS --> Hono
    Hono -- "Kysely (typed SQL)" --> D1
    Hono --> R2
    Hono --> Assets
    Hono <--> OAuth
```

**Key insight:** there is **one Worker**. It serves the API *and* the static SPA. No separate frontend host. The `ASSETS` binding with `not_found_handling: "single-page-application"` is what makes deep links like `/profile` work on refresh.

## 3. Data model (D1 / SQLite)

```mermaid
erDiagram
    USER ||--o{ DOODIE : reports
    USER ||--o{ COMMENT : writes
    USER ||--o{ AUDIT_LOG : "acts in"
    TOWN ||--o{ DOODIE : scopes
    DOODIE ||--o{ DOODIE_IMAGE : has
    DOODIE ||--o{ VOTE : "up/down tallied separately"
    DOODIE ||--o{ COMMENT : has
    COMMENT ||--o{ COMMENT_VOTE : tallies
    COMMENT ||--o{ REPORT : "flagged by"

    USER {
        string id PK
        string screen_name "public, unique nocase"
        string display_name "private, from OAuth"
        int    brownie_points "karma"
        string status "active | banned"
        string country "required"
        string city "optional"
        datetime terms_accepted_at
    }
    TOWN {
        string slug PK "e.g. boston-ma"
        string name
        string state
        string country
    }
    DOODIE {
        string id PK
        string slug
        string town_slug FK
        string type "meter | garage | enforcement"
        string description
        bool   approved
        bool   disability_related
        string reporter_id FK
    }
    COMMENT {
        string id PK
        string doodie_id FK
        string user_id FK
        string body
        string ip_address "for accountability"
    }
```

Migrations live in `migrations/` and apply in numeric order — `0001_init` → `0004_screen_name_nocase`.

## 4. Request lifecycle — "user files a Doodie with a photo"

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (SPA)
    participant W as Worker entry
    participant MW as Middleware
    participant H as routes/doodies.ts
    participant DB as D1
    participant S as R2

    B->>W: POST /api/towns/boston-ma/doodies<br/>multipart: type, description, images[]<br/>Authorization: Bearer <session>
    W->>MW: rate-limit (sliding window)
    MW->>MW: requireAuth — session lookup + ban check
    MW->>H: handler
    H->>H: Zod-validate form against schema
    H->>DB: insert doodie (Kysely)
    H->>S: stream each image, store R2 keys
    H->>DB: append audit_log entry
    H-->>B: 201 + Doodie JSON (slug, image URLs)
```

The **same pattern** repeats for every endpoint: middleware → Zod schema → Kysely query → optional R2 → JSON. Get one route, you get all of them.

## 5. Tech stack & why

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Cloudflare Workers** | Global edge, zero ops, generous free tier |
| API framework | **Hono** + `@hono/zod-openapi` | Tiny, Workers-native, schema = docs |
| DB | **D1** (SQLite at the edge) | Same-region as Worker, no connection pool |
| Storage | **R2** | S3-compatible, no egress fees, perfect for images |
| Query builder | **Kysely** + `kysely-d1` | Type-safe, no ORM bloat |
| Auth | **better-auth** | Drop-in OAuth + email/password + bearer tokens |
| Frontend | **Svelte 5** + **Vite** | Small bundle, reactive runes, fast HMR |
| Docs | **Scalar** at `/api/docs` | Auto-generated from Zod schemas |

## 6. Environments & deploy

```mermaid
flowchart LR
    Code["Source<br/>(this repo)"]
    Code -->|"npm run dev<br/>+ npm run dev:web"| Local["<b>Local</b><br/>Miniflare<br/>.wrangler/state/<br/>:8787 + :5173"]
    Code -->|"npm run preflight"| Build["Build + typecheck"]
    Build -->|"npm run deploy:staging"| Staging["<b>Staging</b><br/>parking-staging.civicdoodie.org"]
    Build -->|"npm run deploy:prod"| Prod["<b>Production</b><br/>parking.civicdoodie.org"]
```

- `npm run dev` — Worker on `:8787`
- `npm run dev:web` — Vite on `:5173`, proxies `/api` to `:8787`
- `npm run preflight` — build web + backend typecheck (**CI runs the same thing**)
- `wrangler.json` is the local config; `wrangler.deploy.json` is what ships to staging/prod

## 7. What to know before your first PR

1. **OpenAPI is the source of truth.** New route → add its declaration in `src/openapi-routes.ts` and its Zod schema in `src/schemas.ts`. The Scalar UI updates automatically.
2. **Always go through middleware.** `requireAuth` for any user action; `requireAdmin` (which returns **404**, not 403) for moderation so admin endpoints don't leak.
3. **`"user"` is a SQL reserved word** — quote it in D1 queries.
4. **Local D1 is a real SQLite file** in `.wrangler/state/v3/d1/`. Reset with `rm -rf .wrangler/state && npm run migrate:local`.
5. **Run `npm run preflight` before pushing.** Same checks as CI. Green here = green there.

## Appendix — Mermaid quick reference

Any fenced block tagged `mermaid` renders inline on GitHub:

````markdown
```mermaid
flowchart LR
  A[Start] --> B{Decision}
  B -->|yes| C[Do thing]
  B -->|no|  D[Skip]
```
````

Common diagram types used above:

| Type | When to use |
|---|---|
| `flowchart` | Boxes-and-arrows architecture, build pipelines |
| `sequenceDiagram` | Request flows, time-ordered interactions |
| `erDiagram` | Database schemas, entity relationships |
| `stateDiagram-v2` | Lifecycles (e.g. a Doodie: draft → approved → censored) |
| `gantt` | Timelines, release planning |

Live editor: <https://mermaid.live>. Docs: <https://mermaid.js.org>.
