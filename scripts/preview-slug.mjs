// Pure helpers for deriving a Cloudflare Worker name and hostname from a
// branch name. Shared by build-wrangler-deploy.mjs, preview-gc.mjs, and the
// preview.yml workflow (invoked via `node scripts/preview-slug.mjs <branch>`).
//
// Cloudflare Worker names cap at 63 chars. The prefix below is 28 chars, so
// the slug max is 35.

const PREFIX = "civicdoodie-parking-preview-";
const HOST_SUFFIX = ".parking-staging.civicdoodie.org";
const SLUG_MAX = 35;

export function branchToSlug(branch) {
  return branch
    .toLowerCase()
    .replace(/[/_]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, SLUG_MAX);
}

export function slugToWorkerName(slug) {
  return PREFIX + slug;
}

export function slugToHost(slug) {
  return slug + HOST_SUFFIX;
}

export const constants = { PREFIX, HOST_SUFFIX, SLUG_MAX };

// CLI: `node scripts/preview-slug.mjs <branch>` prints
//   slug=<slug>\nname=<worker-name>\nhost=<host>
// suitable for piping into $GITHUB_OUTPUT.
if (import.meta.url === `file://${process.argv[1]}`) {
  const branch = process.argv[2];
  if (!branch) {
    console.error("usage: preview-slug.mjs <branch>");
    process.exit(2);
  }
  const slug = branchToSlug(branch);
  process.stdout.write(
    `slug=${slug}\nname=${slugToWorkerName(slug)}\nhost=${slugToHost(slug)}\n`,
  );
}
