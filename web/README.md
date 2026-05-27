# CivicDoodie Parking Frontend (`web/`)

This directory houses the single-page application (SPA) frontend for the CivicDoodie-Parking platform. It is built using **Svelte 5** and **Vite**, written entirely in **TypeScript**, and styled with **Vanilla CSS**.

---

## Technical Stack

- **Framework:** Svelte 5 (utilizing reactive Runes like `$state`, `$derived`, `$props`, and `$effect`)
- **Build Tool:** Vite 6
- **Routing:** Hand-rolled reactive router
- **Map Integration:** MapLibre GL (for the interactive town dashboards)
- **Styling:** Vanilla CSS (responsive grid/flex layouts, modern variables, HSL-based dark mode aesthetics)

---

## Project Structure

```text
web/
├── index.html            # SPA Entry point HTML
├── vite.config.ts        # Vite configuration (sets output to ../public and proxies /api)
├── svelte.config.js      # Svelte compiler options
├── tsconfig.json         # TypeScript frontend rules
└── src/
    ├── main.ts           # App mount point
    ├── App.svelte        # Shell & Router controller
    ├── app.css           # Global layout, typography, and variable definitions
    ├── globals.d.ts      # TypeScript global definitions
    ├── components/       # Reusable components
    │   ├── DoodieCard.svelte    # Render card for a single report
    │   └── TownPicker.svelte    # Selection list for municipality/town scope
    ├── pages/            # Page-level components
    │   ├── Landing.svelte       # Initial welcome page
    │   ├── Onboarding.svelte    # Screen-name selector, Terms of Service acceptance
    │   ├── Profile.svelte       # User profile details and provider logins
    │   └── TownDashboard.svelte # Interactive map and list of recent/top Doodies
    └── lib/              # Core logic, state, and types
        ├── api.ts        # Fetch wrappers & helpers for communicating with Hono backend
        ├── auth.svelte.ts# Global reactive authentication state
        ├── router.svelte.ts# Reactive custom URL routing state
        └── types.ts      # Shared frontend TypeScript interfaces
```

---

## Key Architectural Concepts

### 1. Routing
Instead of pulling in a heavy external routing library, the application uses a lightweight, reactive router defined in `src/lib/router.svelte.ts` and managed in `src/App.svelte`.
- URL pathnames are parsed and reactive state represents the active page and parameters.
- Browser history (`pushState` / `popstate`) is intercepted to update routing state without page reloads.

### 2. State & Authentication
Authentication state is kept in `src/lib/auth.svelte.ts` using Svelte 5 Runes.
- The `authState` object exposes the currently logged-in user, session, and boarding state.
- Component state reacts instantly when a user logs in, accept terms, updates their screen name, or signs out.

### 3. API Communication & OpenAPI Alignment
All calls to the Hono backend API go through the client wrappers in [web/src/lib/api.ts](file:///Users/evan/projects/CivicDoodie-Parking/web/src/lib/api.ts).
- **No Generated Client**: Rather than auto-generating the client from the backend `openapi.json` at build time, the frontend uses a clean, manually written fetch wrapper (`api`) for flexibility and control.
- **Manual Type Alignment**: TypeScript interfaces defined in [web/src/lib/types.ts](file:///Users/evan/projects/CivicDoodie-Parking/web/src/lib/types.ts) mirror the Zod/OpenAPI schemas in [src/schemas.ts](file:///Users/evan/projects/CivicDoodie-Parking/src/schemas.ts).
- **Updating the API**: When adding or changing backend routes:
  1. Add/modify the schema in [src/schemas.ts](file:///Users/evan/projects/CivicDoodie-Parking/src/schemas.ts) and path declaration in [src/openapi-routes.ts](file:///Users/evan/projects/CivicDoodie-Parking/src/openapi-routes.ts).
  2. Update the corresponding TypeScript models in [web/src/lib/types.ts](file:///Users/evan/projects/CivicDoodie-Parking/web/src/lib/types.ts).
  3. Implement the fetch method in [web/src/lib/api.ts](file:///Users/evan/projects/CivicDoodie-Parking/web/src/lib/api.ts).
- **Dev Proxy**: The Vite dev server proxies requests starting with `/api` to the backend worker on `http://localhost:8787` (configured in [web/vite.config.ts](file:///Users/evan/projects/CivicDoodie-Parking/web/vite.config.ts)).
- **Authorization**: Credentials and cookies are included by default (`credentials: "include"`), and authorization headers are standardized dynamically.

### 4. Build Output and Serving
In production, Cloudflare Workers serves the built files directly as static assets.
- `web/vite.config.ts` redirects `build.outDir` to `../public` at the root of the repository.
- `wrangler.json` references this `public/` directory under `assets.directory`.
- During deployment, Hono's asset handler serves index.html for all non-API paths, enabling smooth SPA routing (no 404s on browser refreshes).

---

## Developer Commands

Run these from the root directory of the workspace:

```bash
npm run dev:web      # Starts the Vite development server (http://localhost:5173)
npm run check:web    # Runs svelte-check (type checking Svelte templates)
npm run build:web    # Builds the SPA and outputs files to the root /public folder
```
