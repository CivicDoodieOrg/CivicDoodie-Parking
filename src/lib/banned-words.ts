// Lowercase banned words. Whole-word, case-insensitive matching.
// This is the single place to edit the list.
export const BANNED_WORDS: string[] = [
  "damn", "hell", "crap", "ass", "bastard", "bitch",
  "shit", "piss", "dick", "douche", "jackass", "asshole",
];

// Replace each whole-word banned term (case-insensitive) with "****".
// Returns the censored text and whether anything was censored.
export function censor(text: string): { body: string; flagged: boolean } {
  if (BANNED_WORDS.length === 0) return { body: text, flagged: false };
  let flagged = false;
  const escaped = BANNED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
  const body = text.replace(re, () => {
    flagged = true;
    return "****";
  });
  return { body, flagged };
}
