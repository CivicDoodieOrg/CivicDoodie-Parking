# AI Agent Guidance for `web/`

This file provides rules, architectural patterns, and expectations for AI agents (Claude Code, Codex, Copilot, etc.) working on the frontend Svelte application inside the `web/` directory.

---

## Technical Stack & Constraints

- **Core**: Svelte 5 + Vite 6 Single Page Application (SPA).
- **TypeScript**: Written entirely in TypeScript. No plain `.js` or `.jsx` in `web/src/`.
- **State Management**: Use Svelte 5 Runes (`$state`, `$derived`, `$props`, `$effect`) for reactivity. Do **not** use legacy Svelte 4 store APIs (`writable`, `derived`, `$store` syntax) or class-based components.
- **Styling**: Use Vanilla CSS for components. Global variables, layout tokens, and utility styles are defined in [web/src/app.css](src/app.css). **Do NOT introduce TailwindCSS**, Bootstrap, or external styling frameworks unless explicitly requested.

---

## Architectural Conventions

### 1. Routing
- The SPA uses a custom, lightweight, reactive router defined in [web/src/lib/router.svelte.ts](src/lib/router.svelte.ts) and mounted in [web/src/App.svelte](src/App.svelte).
- **Do not** add router packages (like `svelte-routing` or `svelte-navigator`). All routes are parsed reactively from `window.location.pathname`.

### 2. API & RPC Client
- **OpenAPI is Authoritative**: The OpenAPI specification defined on the backend (routes in [src/openapi-routes.ts](../src/openapi-routes.ts) and schemas in [src/schemas.ts](../src/schemas.ts)) is the absolute source of truth for the API contract. All request parameters, body payloads, and response structures must align exactly with the OpenAPI spec.
- **Hono Client Integration**: The frontend connects to the Hono backend via Hono's RPC client (`hc`) instantiated in [web/src/lib/api.ts](src/lib/api.ts).
- **Client Typing**: The underlying `client` instance in the frontend is cast to `any` to prevent compiler/type noise from un-typed endpoints (like BetterAuth wildcard handlers). Since autocompletion is not available on the raw client, developers must consult the backend's OpenAPI definitions directly.
- **Facade Pattern**: Page components must never call the Hono `client` directly. They must use the strictly-typed `api` facade object exported from [web/src/lib/api.ts](src/lib/api.ts) to execute API calls, maintaining strict type safety for Svelte components.
- **Preview Auth Base URL**: The client must check `__AUTH_BASE_URL__` (injected by Vite during branch-preview builds) to route social sign-ins through `auth.preview.civicdoodie.org` when active. Other API calls remain relative.

### 3. Type Safety & Schema Alignment
- **Do not manually duplicate database or API schema fields** in the frontend.
- Instead, import the Zod schemas from the backend ([src/schemas.ts](../src/schemas.ts)) and infer the frontend TypeScript types in [web/src/lib/types.ts](src/lib/types.ts) using `z.infer`:
  ```typescript
  import type { z } from "zod";
  import type { TownSchema } from "../../../src/schemas";
  export type Town = z.infer<typeof TownSchema>;
  ```

---

## Environment & Global Declarations

### 1. Global Constants
Vite injects several compile-time constants declared in [web/src/globals.d.ts](src/globals.d.ts):
- `__APP_VERSION__`: Package version.
- `__GIT_REF__`: Git HEAD commit hash.
- `__AUTH_BASE_URL__`: Target OAuth domain (used only in preview branch builds).

### 2. Workers vs DOM Types
To prevent namespace collisions between the browser DOM library and Cloudflare Workers types when the compiler type-checks imported backend schemas:
- [web/src/globals.d.ts](src/globals.d.ts) declares mock interfaces (with index signatures) for Cloudflare Workers classes (`D1Database`, `D1PreparedStatement`, `Fetcher`, `R2Bucket`).
- It overrides browser global types (`Response`, `Request`, `Headers`, `ReadableStream`) to `any` in the global scope of the frontend.
- **Do not load `@cloudflare/workers-types` globally** in [web/tsconfig.json](tsconfig.json).

### 3. Node.js Mocking
- `better-auth` references Node.js built-ins (`node:sqlite`, `node:async_hooks`).
- Since the browser workspace has no Node.js type definitions, these are mapped in [web/tsconfig.json](tsconfig.json)'s `paths` block to [web/src/lib/empty.d.ts](src/lib/empty.d.ts) to satisfy module resolution.

---

## Verification Commands

Before reporting any frontend task complete or pushing changes:

```bash
npm run check:web    # Run Svelte templates and TypeScript type checking
npm run build:web    # Build production assets to /public and verify compilation
npm run dev:web      # Run local web development server (port 5173)
```
