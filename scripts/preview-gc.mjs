#!/usr/bin/env node
// Lists Cloudflare Workers prefixed with `civicdoodie-parking-preview-`,
// compares against current remote `web-*` branches, and deletes orphans.
//
// Required env:
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Optional:
//   DRY_RUN=1  — log deletes instead of executing them.

import { execFileSync } from "node:child_process";
import { branchToSlug, slugToWorkerName, constants } from "./preview-slug.mjs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const dryRun = process.env.DRY_RUN === "1";
if (!token || !accountId) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required");
  process.exit(2);
}

const cf = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!body.success) {
    throw new Error(`CF API ${path} failed: ${JSON.stringify(body.errors)}`);
  }
  return body.result;
};

const branchOutput = execFileSync(
  "git",
  ["ls-remote", "--heads", "origin", "web-*"],
  { encoding: "utf-8" },
);
const liveWorkerNames = new Set(
  branchOutput
    .split("\n")
    .map((line) => line.split("refs/heads/")[1])
    .filter(Boolean)
    .map((branch) => slugToWorkerName(branchToSlug(branch))),
);

const workers = await cf(`/accounts/${accountId}/workers/scripts`);
const previewWorkers = workers.filter((w) => w.id.startsWith(constants.PREFIX));

const orphans = previewWorkers.filter((w) => !liveWorkerNames.has(w.id));

console.log(
  `Found ${previewWorkers.length} preview workers, ${orphans.length} orphan(s).`,
);
for (const w of orphans) {
  if (dryRun) {
    console.log(`[dry-run] would delete ${w.id}`);
    continue;
  }
  console.log(`Deleting ${w.id}...`);
  await cf(`/accounts/${accountId}/workers/scripts/${w.id}`, {
    method: "DELETE",
  });
}
