// Random adj-noun-num suggestions for first-time users picking a screen name.
// The whole point is privacy: we never derive suggestions from the user's
// OAuth display name. Pure random combo, fully detached from real identity.
//
// Word lists are intentionally small, common, and reviewed: no aggressive,
// edgy, political, or potentially loaded words. All-lowercase ASCII so the
// generated suggestion always passes validateScreenName().

const ADJECTIVES = [
  "bold", "brave", "breezy", "bright", "calm", "cheerful", "clever", "cozy",
  "crisp", "dapper", "daring", "eager", "fancy", "fluffy", "gallant", "gentle",
  "happy", "jaunty", "jolly", "kind", "lively", "lucky", "mellow", "merry",
  "neat", "nimble", "peppy", "perky", "plucky", "polite", "quick", "quiet",
  "ready", "rosy", "sharp", "sleek", "smart", "smooth", "snappy", "snug",
  "spry", "sturdy", "sunny", "swift", "tidy", "vibrant", "warm", "witty",
  "zesty", "zippy",
] as const;

const NOUNS = [
  "badger", "beaver", "breeze", "comet", "dolphin", "eagle", "ember", "falcon",
  "finch", "fox", "frost", "garden", "glade", "hare", "harbor", "heron",
  "koala", "lantern", "lynx", "marten", "meadow", "mountain", "nebula",
  "orchard", "otter", "owl", "panda", "pebble", "pelican", "penguin", "puffin",
  "quail", "rabbit", "raccoon", "river", "robin", "salmon", "spark", "sparrow",
  "squirrel", "stream", "sunset", "swan", "toucan", "trout", "valley",
  "walrus", "wave", "whale", "willow",
] as const;

function pickRandom<T>(arr: readonly T[]): T {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  const idx = ((bytes[0] << 8) | bytes[1]) % arr.length;
  return arr[idx];
}

// 10–999 — keeps suggestions short while leaving enough room that the same
// adj+noun pair isn't immediately re-suggested.
function randomNumber(): number {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  return 10 + (((bytes[0] << 8) | bytes[1]) % 990);
}

export function generateScreenNameSuggestion(): string {
  return `${pickRandom(ADJECTIVES)}-${pickRandom(NOUNS)}-${randomNumber()}`;
}
