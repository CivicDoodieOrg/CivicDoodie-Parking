import { describe, it, expect } from "vitest";
import { censor } from "./banned-words";

describe("censor", () => {
  it("replaces a whole banned word with **** and flags it", () => {
    const r = censor("oh damn that hurts");
    expect(r.body).toBe("oh **** that hurts");
    expect(r.flagged).toBe(true);
  });

  it("leaves clean text untouched and unflagged", () => {
    const r = censor("the meter is broken");
    expect(r.body).toBe("the meter is broken");
    expect(r.flagged).toBe(false);
  });

  it("is case-insensitive", () => {
    const r = censor("DAMN it");
    expect(r.body).toBe("**** it");
    expect(r.flagged).toBe(true);
  });

  it("does not censor a banned word embedded in a clean word (whole-word only)", () => {
    // "class" contains "ass" but must NOT be censored
    const r = censor("the class was great");
    expect(r.body).toBe("the class was great");
    expect(r.flagged).toBe(false);
  });

  it("censors multiple banned words in one message", () => {
    const r = censor("damn and hell");
    expect(r.body).toBe("**** and ****");
    expect(r.flagged).toBe(true);
  });
});
