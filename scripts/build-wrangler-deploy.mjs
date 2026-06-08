#!/usr/bin/env node
// Generates wrangler.deploy.json from the committed wrangler.json (local-dev only)
// plus the staging/prod D1 database IDs supplied via environment variables.
//
// Why: D1 database_ids are tied to a Cloudflare account, so we keep them out of
// the public repo. Local dev doesn't need them; only deploys do.
//
// Required env vars:
//   STAGING_D1_DATABASE_ID  — UUID of the staging D1 database
//   PROD_D1_DATABASE_ID     — UUID of the prod D1 database
//
// In CI: set both as GitHub Secrets and pass through `env:` in the workflow step.
// Locally: export both before running `npm run deploy:*` or `npm run migrate:{staging,prod}`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const stagingId = process.env.STAGING_D1_DATABASE_ID;
const prodId = process.env.PROD_D1_DATABASE_ID;

const missing = [];
if (!stagingId) missing.push("STAGING_D1_DATABASE_ID");
if (!prodId) missing.push("PROD_D1_DATABASE_ID");
if (missing.length) {
  console.error(
    `ERROR: missing required env var(s): ${missing.join(", ")}\n\n` +
      `These hold the D1 database UUIDs for staging and prod and must be set\n` +
      `before deploying. Get them from \`npx wrangler d1 list\` or the Cloudflare\n` +
      `dashboard (Workers & Pages → D1 SQL Database).`
  );
  process.exit(1);
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRe.test(stagingId)) {
  console.error(`ERROR: STAGING_D1_DATABASE_ID is not a valid UUID: ${stagingId}`);
  process.exit(1);
}
if (!uuidRe.test(prodId)) {
  console.error(`ERROR: PROD_D1_DATABASE_ID is not a valid UUID: ${prodId}`);
  process.exit(1);
}

const basePath = resolve(repoRoot, "wrangler.json");
const base = JSON.parse(readFileSync(basePath, "utf-8"));
const sendEmail = Array.isArray(base.send_email) ? base.send_email : [];
const authEmailVars = {
  AUTH_EMAIL_FROM: "noreply@civicdoodie.org",
  AUTH_EMAIL_FROM_NAME: "CivicDoodie Parking",
  AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
};

const previewName = process.env.PREVIEW_NAME;
const previewHost = process.env.PREVIEW_HOST;
if (previewName && !previewHost) {
  console.error("ERROR: PREVIEW_NAME set but PREVIEW_HOST missing.");
  process.exit(1);
}
if (previewHost && !previewName) {
  console.error("ERROR: PREVIEW_HOST set but PREVIEW_NAME missing.");
  process.exit(1);
}

const stagingD1 = {
  binding: "DB",
  database_name: "civicdoodie-parking-db-staging",
  database_id: stagingId,
};
const stagingR2 = {
  binding: "IMAGES",
  bucket_name: "civicdoodie-parking-images-staging",
};

const deploy = {
  ...base,
  env: {
    prod: {
      name: "civicdoodie-parking",
      routes: [{ pattern: "parking.civicdoodie.org", custom_domain: true }],
      send_email: sendEmail,
      d1_databases: [
        {
          binding: "DB",
          database_name: "civicdoodie-parking-db-prod",
          database_id: prodId,
        },
      ],
      r2_buckets: [
        { binding: "IMAGES", bucket_name: "civicdoodie-parking-images" },
      ],
      vars: authEmailVars,
    },
    staging: {
      name: "civicdoodie-parking-staging",
      routes: [
        { pattern: "parking-staging.civicdoodie.org", custom_domain: true },
      ],
      send_email: sendEmail,
      d1_databases: [stagingD1],
      r2_buckets: [stagingR2],
      vars: {
        ...authEmailVars,
        // Cookies are scoped to the parking-staging tree so preview Workers
        // under <slug>.parking-staging.civicdoodie.org share sessions with
        // staging. Prod (parking.civicdoodie.org) is outside this scope.
        AUTH_COOKIE_DOMAIN: ".parking-staging.civicdoodie.org",
        AUTH_TRUSTED_ORIGINS: "https://*.parking-staging.civicdoodie.org",
      },
    },
    ...(previewName
      ? {
          preview: {
            name: previewName,
            routes: [{ pattern: previewHost, custom_domain: true }],
            send_email: sendEmail,
            d1_databases: [stagingD1],
            r2_buckets: [stagingR2],
            vars: {
              ...authEmailVars,
              BETTER_AUTH_URL: `https://${previewHost}`,
              AUTH_COOKIE_DOMAIN: ".parking-staging.civicdoodie.org",
              AUTH_TRUSTED_ORIGINS: "https://parking-staging.civicdoodie.org",
            },
          },
        }
      : {}),
  },
};

const outPath = resolve(repoRoot, "wrangler.deploy.json");
writeFileSync(outPath, JSON.stringify(deploy, null, "\t") + "\n");
console.log(`Wrote ${outPath}`);
