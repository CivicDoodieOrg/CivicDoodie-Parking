# OpenAPI Integration in CivicDoodie Parking

This project uses OpenAPI to document, validate, and test its REST API. The documentation is served dynamically at `/api/docs` via the **Scalar** UI and generated as a static JSON file via Wrangler.

---

## The Tech Stack

- **[@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)**: Extends Hono to register OpenAPI paths and validate inputs/outputs using Zod.
- **[@scalar/hono-api-reference](https://github.com/scalar/scalar)**: Renders the interactive documentation UI.
- **[Zod](https://zod.dev/)**: Validates incoming request parameters, headers, bodies, and outgoing responses.

---

## Directory & File Structure

The OpenAPI integration is split across several files to separate documentation definitions from runtime logic:

```text
src/
├── index.ts                # Orchestrator: mounts routes and registers OpenAPI definitions
├── schemas.ts              # Contains all Zod validation schemas
├── openapi-routes.ts       # Declares routes (paths, methods, params, request/response bodies)
└── routes/                 # Runtime controller/handler files (e.g., towns.ts, doodies.ts)
```

---

## How It Works Under the Hood

### 1. Defining Schemas (`src/schemas.ts`)
We use `@hono/zod-openapi`'s wrapper for `z`. This allows us to chain `.openapi("Name")` to register components under schemas inside the generated spec.

```typescript
import { z } from "@hono/zod-openapi";

export const TownSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
}).openapi("Town"); // Registers as component schema 'Town'
```

### 2. Declaring Routes (`src/openapi-routes.ts`)
Routes are defined purely declaratively using `createRoute`. This file contains **no runtime handlers**.

```typescript
import { createRoute } from "@hono/zod-openapi";
import { TownSchema } from "./schemas";

export const getTownRoute = createRoute({
  method: "get",
  path: "/api/towns/{slug}",
  tags: ["Towns"],
  summary: "Get a town by slug",
  request: {
    params: z.object({
      slug: z.string().openapi({ param: { name: "slug", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "Town details",
      content: {
        "application/json": { schema: TownSchema },
      },
    },
  },
});
```

### 3. Orchestration & Registration (`src/index.ts`)
To avoid writing verbose `app.openapi(...)` handlers directly in the controller files, we register the paths dynamically in `src/index.ts` from the exports of `openapi-routes.ts`:

```typescript
import * as openapiRoutes from "./openapi-routes";

// ... mounts runtime controllers (e.g., app.route("/api/towns", towns))

// Register every exported route declaration with the OpenAPI registry
for (const route of Object.values(openapiRoutes)) {
  app.openAPIRegistry.registerPath(route);
}

// Serve the raw openapi.json file
app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "CivicDoodie Parking API",
    version: "0.0.1",
  },
});

// Render the interactive Scalar UI docs
app.get("/api/docs", Scalar({ url: "/api/openapi.json" }));
```

### 4. Implementing Runtime Controllers (`src/routes/*.ts`)
The controllers in `src/routes/` are standard, clean Hono routers. They use Hono's standard route syntax (e.g., `/` which resolves to `/api/towns/` when mounted, or `/:slug` which matches the OpenAPI `{slug}` path parameter pattern):

```typescript
import { Hono } from "hono";

export const towns = new Hono<Env>();

towns.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Fetch from DB and return json...
  return c.json({ ... });
});
```
*Note: Hono's route matcher aligns the runtime routes dynamically against the paths registered in the OpenAPI registry.*

---

## CLI Commands

### Generate a Static `openapi.json`
To export a formatted static copy of the OpenAPI spec to the root of the project, run:

```bash
npm run generate:openapi
```

This script:
1. Temporarily spins up `wrangler dev` on port `8787` in the background.
2. Fetches the generated `/api/openapi.json` spec.
3. Formats it with Prettier and outputs it to `openapi.json` at the project root.
4. Cleans up and kills the Wrangler process.
