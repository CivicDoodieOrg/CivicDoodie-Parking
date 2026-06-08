import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const script = resolve(repoRoot, "scripts/build-wrangler-deploy.mjs");
const outFile = resolve(repoRoot, "wrangler.deploy.json");

const fakeUuid = "11111111-2222-3333-4444-555555555555";
const env = {
  ...process.env,
  STAGING_D1_DATABASE_ID: fakeUuid,
  PROD_D1_DATABASE_ID: fakeUuid,
};

function run(extraEnv = {}) {
  if (existsSync(outFile)) unlinkSync(outFile);
  execFileSync("node", [script], { env: { ...env, ...extraEnv } });
  return JSON.parse(readFileSync(outFile, "utf-8"));
}

describe("build-wrangler-deploy", () => {
  it("emits staging and prod envs without PREVIEW_NAME", () => {
    const cfg = run();
    expect(cfg.env.staging.name).toBe("civicdoodie-parking-staging");
    expect(cfg.env.prod.name).toBe("civicdoodie-parking");
    expect(cfg.env.staging.send_email).toEqual(cfg.send_email);
    expect(cfg.env.prod.send_email).toEqual(cfg.send_email);
    expect(cfg.env.prod.vars.AUTH_EMAIL_FROM).toBe("noreply@civicdoodie.org");
    expect(cfg.env.staging.vars.AUTH_EMAIL_FROM).toBe("noreply@civicdoodie.org");
    expect(cfg.env.preview).toBeUndefined();
  });

  it("staging env carries cookie-domain vars for cross-subdomain sessions", () => {
    const cfg = run();
    expect(cfg.env.staging.vars.AUTH_COOKIE_DOMAIN).toBe(
      ".parking-staging.civicdoodie.org",
    );
    expect(cfg.env.staging.vars.AUTH_TRUSTED_ORIGINS).toContain(
      "*.parking-staging.civicdoodie.org",
    );
  });

  it("emits a preview env when PREVIEW_NAME and PREVIEW_HOST are set", () => {
    const cfg = run({
      PREVIEW_NAME: "civicdoodie-parking-preview-web-foo",
      PREVIEW_HOST: "web-foo.parking-staging.civicdoodie.org",
    });
    const p = cfg.env.preview;
    expect(p.name).toBe("civicdoodie-parking-preview-web-foo");
    expect(p.routes).toEqual([
      { pattern: "web-foo.parking-staging.civicdoodie.org", custom_domain: true },
    ]);
    expect(p.send_email).toEqual(cfg.send_email);
    expect(p.d1_databases[0].database_id).toBe(fakeUuid);
    expect(p.d1_databases[0].database_name).toBe("civicdoodie-parking-db-staging");
    expect(p.r2_buckets[0].bucket_name).toBe("civicdoodie-parking-images-staging");
    expect(p.vars.AUTH_COOKIE_DOMAIN).toBe(".parking-staging.civicdoodie.org");
    expect(p.vars.AUTH_TRUSTED_ORIGINS).toBe(
      "https://parking-staging.civicdoodie.org",
    );
    expect(p.vars.BETTER_AUTH_URL).toBe(
      "https://web-foo.parking-staging.civicdoodie.org",
    );
    expect(p.vars.AUTH_EMAIL_FROM).toBe("noreply@civicdoodie.org");
  });

  it("fails fast if PREVIEW_NAME is set but PREVIEW_HOST is not", () => {
    expect(() =>
      run({ PREVIEW_NAME: "civicdoodie-parking-preview-web-foo" }),
    ).toThrow();
  });
});
