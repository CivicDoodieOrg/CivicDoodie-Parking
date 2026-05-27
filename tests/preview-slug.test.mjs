import { describe, expect, it } from "vitest";
import { branchToSlug, slugToWorkerName, slugToHost } from "../scripts/preview-slug.mjs";

describe("branchToSlug", () => {
  it("lowercases", () => {
    expect(branchToSlug("web-FooBar")).toBe("web-foobar");
  });

  it("replaces slashes and underscores with hyphens", () => {
    expect(branchToSlug("web-foo/bar_baz")).toBe("web-foo-bar-baz");
  });

  it("strips characters outside [a-z0-9-]", () => {
    expect(branchToSlug("web-foo.bar!baz@2")).toBe("web-foobarbaz2");
  });

  it("truncates to 35 characters", () => {
    const long = "web-" + "a".repeat(100);
    const slug = branchToSlug(long);
    expect(slug.length).toBe(35);
    expect(slug.startsWith("web-")).toBe(true);
  });

  it("leaves a short already-valid name unchanged", () => {
    expect(branchToSlug("web-foo")).toBe("web-foo");
  });
});

describe("slugToWorkerName", () => {
  it("prefixes with civicdoodie-parking-preview-", () => {
    expect(slugToWorkerName("web-foo")).toBe("civicdoodie-parking-preview-web-foo");
  });

  it("produces names <= 63 characters even for a 35-char slug", () => {
    const slug = "a".repeat(35);
    expect(slugToWorkerName(slug).length).toBeLessThanOrEqual(63);
  });
});

describe("slugToHost", () => {
  it("appends .parking-staging.civicdoodie.org", () => {
    expect(slugToHost("web-foo")).toBe("web-foo.parking-staging.civicdoodie.org");
  });
});
