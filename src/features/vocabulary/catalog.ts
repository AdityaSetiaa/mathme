// Terms used throughout the UI and code:
//   Discover: find a new word.        Seen: the user has been shown it (permanent; drives uniqueness).
//   Favorite: explicitly starred.     Learned: explicitly marked learned (never set automatically).
//   Remove from Your Words: hidden from the collection, still seen, never discovered again.
//   Forget Word: the user's record is deleted, so the word may be discovered again.
//
// Three independent dimensions describe a word, and none is derived from another:
//   CEFR level  — A1…C2 from the CEFR-J / Octanove profiles (or a labelled Words-CEFR estimate). CEFR ends at C2.
//   Rarity      — how often the word occurs (wordfreq zipf), very common … very rare.
//   Style       — register labels from Wiktionary and WordNet: literary, poetic, formal, archaic, technical.
// The difficulty tier used in settings combines CEFR and rarity: words in the CEFR lists keep their CEFR band;
// words beyond them are this app's "C2+" tiers (C2+, Rare, Very Rare). C2+ is not an official CEFR level.

export const DISCOVERY_CATEGORIES = ["positive", "sad", "confident", "intimate", "sexual", "vulgar", "cuss", "insult", "sarcasm", "general"] as const;
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

// "random" is a way of discovering, never stored on a word: a random word keeps the real category it came from.
export type DiscoveryMode = DiscoveryCategory | "random";

export const CATEGORY_INFO: Record<DiscoveryCategory, { label: string; sensitive?: true }> = {
  positive: { label: "Positive" },
  sad: { label: "Sad" },
  confident: { label: "Confident" },
  intimate: { label: "Intimate" },
  sexual: { label: "Sexual", sensitive: true },
  vulgar: { label: "Vulgar", sensitive: true },
  cuss: { label: "Cuss", sensitive: true },
  insult: { label: "Insult", sensitive: true },
  sarcasm: { label: "Sarcasm" },
  general: { label: "General" }, // every other word in the open-data lexicon: luminous, threnody, gossamer…
};

// Sensitive categories are opt-in.
export const DEFAULT_ENABLED: DiscoveryCategory[] = DISCOVERY_CATEGORIES.filter((c) => !CATEGORY_INFO[c].sensitive);

export type WordLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type CefrSource = "cefrj" | "octanove" | "words-cefr";
export const CEFR_SOURCE_INFO: Record<CefrSource, { label: string; official: boolean }> = {
  cefrj: { label: "CEFR-J Vocabulary Profile", official: true },
  octanove: { label: "Octanove C1/C2 Vocabulary Profile", official: true },
  "words-cefr": { label: "estimated by Words-CEFR-Dataset", official: false },
};

// Rarity from wordfreq's zipf scale (log10 of occurrences per billion words; 3 = once per million). Steps were
// chosen after inspecting the lexicon's distribution (deciles 1.36 … 4.20, see data/lexicon-stats.json) and
// split it roughly 13% / 27% / 30% / 15% / 15%. A word wordfreq doesn't know (zipf 0) is very rare.
export const RARITIES = ["very_common", "common", "uncommon", "rare", "very_rare"] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_INFO: Record<Rarity, { label: string; minZipf: number }> = {
  very_common: { label: "Very common", minZipf: 4 },
  common: { label: "Common", minZipf: 3 },
  uncommon: { label: "Uncommon", minZipf: 2 },
  rare: { label: "Rare", minZipf: 1.5 },
  very_rare: { label: "Very rare", minZipf: -Infinity },
};
export const rarityOf = (zipf: number): Rarity => RARITIES.find((r) => zipf >= RARITY_INFO[r].minZipf)!;
export const perMillion = (zipf: number) => 10 ** (zipf - 3);

// The difficulty tiers in settings.
export const DIFFICULTIES = ["easy", "medium", "hard", "advanced", "c2_plus", "rare", "very_rare"] as const;
export type WordDifficulty = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_INFO: Record<WordDifficulty, { label: string; detail: string; blurb: string }> = {
  easy: { label: "Easy", detail: "A1–A2", blurb: "Everyday words" },
  medium: { label: "Medium", detail: "B1–B2", blurb: "Common in conversation and news" },
  hard: { label: "Hard", detail: "C1", blurb: "Precise, less common words" },
  advanced: { label: "Advanced", detail: "C2", blurb: "The top of the CEFR word lists" },
  c2_plus: { label: "C2+", detail: "Beyond CEFR · uncommon", blurb: "Not in any CEFR list, still in regular use" },
  rare: { label: "Rare", detail: "Beyond CEFR · rare", blurb: "Seldom seen outside books" },
  very_rare: { label: "Very rare", detail: "Beyond CEFR · very rare", blurb: "The deep end of the dictionary" },
};
export const DEFAULT_DIFFICULTIES: WordDifficulty[] = [...DIFFICULTIES];
export const BEYOND_CEFR: WordDifficulty[] = ["c2_plus", "rare", "very_rare"];
export const isDifficulty = (s: unknown): s is WordDifficulty => DIFFICULTIES.includes(s as WordDifficulty);

const CEFR_TIER: Record<WordLevel, WordDifficulty> = { A1: "easy", A2: "easy", B1: "medium", B2: "medium", C1: "hard", C2: "advanced" };
// CEFR evidence decides the tier. Without it, rarity does: uncommon/rare/very rare words are the beyond-C2 tiers,
// and the few common words the lists don't rate (heartache, azure) sit in Medium/Hard. Those get a tier for
// filtering only; they're never shown with a CEFR level.
const UNRATED_TIER: Record<Rarity, WordDifficulty> = { very_common: "medium", common: "hard", uncommon: "c2_plus", rare: "rare", very_rare: "very_rare" };
export function tierOf(cefr: WordLevel | undefined, rarity: Rarity): WordDifficulty {
  return cefr ? CEFR_TIER[cefr] : UNRATED_TIER[rarity];
}

// Register/style. Words without a label count as Everyday. A word is offered when any of its styles is turned on.
export const STYLES = ["everyday", "formal", "literary", "poetic", "archaic", "technical"] as const;
export type WordStyle = (typeof STYLES)[number];
export const STYLE_INFO: Record<WordStyle, { label: string; blurb: string }> = {
  everyday: { label: "Everyday", blurb: "No special register" },
  formal: { label: "Formal", blurb: "Official or ceremonious usage" },
  literary: { label: "Literary", blurb: "Mostly found in written literature" },
  poetic: { label: "Poetic", blurb: "Mostly found in poetry" },
  archaic: { label: "Archaic", blurb: "Old-fashioned, rarely used today" },
  technical: { label: "Technical", blurb: "Scientific, legal and other jargon" },
};
export const DEFAULT_STYLES: WordStyle[] = ["everyday", "formal", "literary", "poetic"]; // archaic and technical are opt-in
export const isStyle = (s: unknown): s is WordStyle => STYLES.includes(s as WordStyle);
const STYLE_BITS: [Exclude<WordStyle, "everyday">, number][] = [["literary", 1], ["poetic", 2], ["formal", 4], ["archaic", 8], ["technical", 16]];
export const stylesOf = (bits: number): WordStyle[] => {
  const styles = STYLE_BITS.filter(([, b]) => bits & b).map(([s]) => s);
  return styles.length ? styles : ["everyday"];
};

// What a word's dataset entry says, derived on read so thresholds can change without touching stored words.
export type WordClass = { level?: WordLevel; cefrSource?: CefrSource; frequency: number; rarity: Rarity; tier: WordDifficulty; styles: WordStyle[] };
export function classify(e: { cefr?: WordLevel; cefrSource?: CefrSource; zipf: number; styleBits: number }): WordClass {
  const rarity = rarityOf(e.zipf);
  return { level: e.cefr, cefrSource: e.cefrSource, frequency: e.zipf, rarity, tier: tierOf(e.cefr, rarity), styles: stylesOf(e.styleBits) };
}
export const matchesSettings = (c: WordClass, s: Pick<VocabSettings, "difficulties" | "styles">) =>
  s.difficulties.includes(c.tier) && c.styles.some((st) => s.styles.includes(st));

// "C1", "≈B2" (an estimate, not an official rating) or "C2+" (this app's tier beyond the CEFR lists).
export function levelLabel(w: { level?: WordLevel; cefrSource?: CefrSource; tier?: WordDifficulty }): string | undefined {
  if (w.level) return w.cefrSource && !CEFR_SOURCE_INFO[w.cefrSource].official ? `≈${w.level}` : w.level;
  return w.tier && BEYOND_CEFR.includes(w.tier) ? "C2+" : undefined;
}
// The short line on a word card: "C2 · Rare · Literary", "C2+ · Very rare · Poetic".
export function classLine(w: Partial<WordClass>): string[] {
  const out = [levelLabel({ level: w.level, cefrSource: w.cefrSource, tier: w.tier })];
  if (w.rarity === "rare" || w.rarity === "very_rare") out.push(RARITY_INFO[w.rarity].label);
  const style = w.styles?.find((s) => s !== "everyday");
  if (style) out.push(STYLE_INFO[style].label);
  return out.filter((x): x is string => !!x);
}

// Canonical facts about a word, normalized from the providers and stored so the app never needs them again.
// Optional fields stay empty when no provider supplies them; nothing is invented to fill the UI.
export type Word = {
  id: string; // normalizeWord(word): the uniqueness key
  word: string; // display spelling
  definition: string;
  example?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  audioUrl?: string;
  synonyms: string[];
  antonyms: string[];
  relatedWords?: string[]; // WordNet broader/narrower/similar concepts
  otherSenses?: { partOfSpeech?: string; definition: string }[]; // WordNet's other meanings, kept separate
  descriptors?: string[]; // formal, informal, literary, slang…: Wiktionary's usage labels for the chosen sense
  discoveryCategories: DiscoveryCategory[]; // what the user asked for when it was found
} & Partial<WordClass>; // derived on read from the lexicon, never stored

// This user's relationship with a word. A record existing at all means "seen".
export type UserWord = {
  wordId: string;
  firstSeenAt: number; // epoch ms
  lastSeenAt: number; // discovery, then each time its details are opened
  isFavorite: boolean;
  learned: boolean;
  removedAt: number | null; // set by "Remove from Your Words"
};

export type CollectedWord = Word & Omit<UserWord, "wordId">;

// All three lists are eligibility rules: a category, tier or style that's off never appears, not even in Random.
export type VocabSettings = { enabled: DiscoveryCategory[]; difficulties: WordDifficulty[]; styles: WordStyle[] };
export const DEFAULT_SETTINGS: VocabSettings = { enabled: DEFAULT_ENABLED, difficulties: DEFAULT_DIFFICULTIES, styles: DEFAULT_STYLES };

// Settings saved before the open-data lexicon (no `styles` field): Advanced then meant "every rare word", which now
// lives in the beyond-C2 tiers, so it carries over; the new General category and default styles are switched on.
export function migrateSettings(doc: Partial<VocabSettings> | null): { settings: VocabSettings; migrated: boolean } {
  if (!doc) return { settings: DEFAULT_SETTINGS, migrated: false };
  const enabled = (doc.enabled ?? DEFAULT_ENABLED).filter(isDiscoveryCategory);
  const difficulties = (doc.difficulties ?? DEFAULT_DIFFICULTIES).filter(isDifficulty);
  if (doc.styles) return { settings: { enabled, difficulties, styles: doc.styles.filter(isStyle) }, migrated: false };
  return {
    settings: {
      enabled: [...new Set<DiscoveryCategory>([...enabled, "general"])],
      difficulties: difficulties.includes("advanced") ? [...new Set([...difficulties, ...BEYOND_CEFR])] : difficulties,
      styles: DEFAULT_STYLES,
    },
    migrated: true,
  };
}

export type NextWord =
  | { status: "ok"; word: CollectedWord }
  | { status: "exhausted" } // every candidate is already seen, unusable or outside the chosen tiers/styles
  | { status: "no-categories" } // no category enabled to discover from
  | { status: "no-levels" } // no tier enabled
  | { status: "no-styles" } // no style enabled
  | { status: "error" }; // providers failed; nothing was stored

export const isDiscoveryCategory = (s: unknown): s is DiscoveryCategory => DISCOVERY_CATEGORIES.includes(s as DiscoveryCategory);

// "Serendipity", " SERENDIPITY. " and "serendipity" are one word.
export const normalizeWord = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .replace(/\s+/g, " ");
