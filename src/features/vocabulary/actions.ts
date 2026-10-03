"use server";

import { mongoDb } from "@/lib/mongo-db";
import {
  DISCOVERY_CATEGORIES,
  isDifficulty,
  isDiscoveryCategory,
  isStyle,
  matchesSettings,
  migrateSettings,
  type CollectedWord,
  type DiscoveryCategory,
  type DiscoveryMode,
  type NextWord,
  type UserWord,
  type VocabSettings,
  type Word,
} from "./catalog";
import { categoryWords, classOf, lexiconEntry } from "./lexicon";
import { datamuseCandidates, enrichWord, lookupWord, sensitivity, type Candidate } from "./providers";

// ponytail: no auth, same as the practice data in src/lib/mongo.ts.
// Vocabulary has its own collections, so clearing it can never touch practice data.
// Ids are normalized words and double as _id, so MongoDB itself refuses a duplicate.
const words = () => mongoDb().collection<Word & { _id: string }>("vocab_words");
const userWords = () => mongoDb().collection<UserWord & { _id: string }>("vocab_user_words");
const settings = () => mongoDb().collection<VocabSettings & { _id: string }>("vocab_settings");

// Per server process. A fixed Datamuse query always gives the same answer, and a word the dictionary
// can't define is skipped from then on. A failed fetch is never cached.
const g = globalThis as { vocabPools?: Map<DiscoveryCategory, Promise<Candidate[]>>; vocabMissing?: Set<string>; vocabResolved?: Map<string, Word> };
const pools = (g.vocabPools ??= new Map<DiscoveryCategory, Promise<Candidate[]>>());
const missing = (g.vocabMissing ??= new Set<string>());
// Looked up with an example but not shown (another word won the round): a later request uses it for free.
const resolved = (g.vocabResolved ??= new Map<string, Word>());

async function lookup(c: Candidate, category: DiscoveryCategory) {
  const hit = resolved.get(c.id);
  if (hit) return { ...hit, discoveryCategories: [category] };
  const r = await lookupWord(c, category);
  if (typeof r === "object" && r.example) resolved.set(c.id, r);
  return r;
}

// A category's pool: Datamuse's semantic matches (they carry Wiktionary labels and definitions) plus the lexicon
// words the dataset build placed in the category through WordNet. General is lexicon-only.
const LEXICON_POS: Record<string, string> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
function candidates(c: DiscoveryCategory) {
  let p = pools.get(c);
  if (!p) {
    p = datamuseCandidates(c).then((found) => {
      const ids = new Set(found.map((x) => x.id));
      const extra = categoryWords(c)
        .filter((id) => !ids.has(id))
        .map((id): Candidate => ({ id, pos: LEXICON_POS[lexiconEntry(id)!.pos[0]], definitions: [] }));
      return [...found, ...extra];
    });
    pools.set(c, p);
    p.catch(() => pools.delete(c));
  }
  return p;
}

const shuffle = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const BATCH = 2; // lookups in parallel: Wikimedia rate-limits bursts
const MAX_LOOKUPS = 6; // per request, so at most three rounds: never a long hang

export async function getNextWord(mode: DiscoveryMode): Promise<NextWord> {
  if (mode !== "random" && !isDiscoveryCategory(mode)) throw new Error("Invalid mode");
  const current = await getSettings();
  const { enabled, difficulties, styles } = current;
  const pick = mode === "random" ? shuffle(enabled) : enabled.includes(mode) ? [mode] : [];
  if (!pick.length) return { status: "no-categories" };
  if (!difficulties.length) return { status: "no-levels" };
  if (!styles.length) return { status: "no-styles" };

  try {
    // A disabled category is an eligibility rule, not a filter on labels: its words stay out even when
    // an enabled category's query returns them. If they can't be fetched, nothing is shown (fail closed).
    // General is a catch-all, not a kind of word, so switching it off only stops drawing from it.
    const disabled = DISCOVERY_CATEGORIES.filter((c) => !enabled.includes(c) && c !== "general");
    const blocked = (await Promise.all(disabled.map(candidates))).flat().map((c) => c.id);
    // The stored history is the only source of truth for "seen".
    const exclude = new Set([...blocked, ...(await userWords().distinct("_id")), ...missing]);
    const rude = enabled.includes("vulgar") || enabled.includes("cuss");
    // The one eligibility rule every path uses (Random, a category, later rounds, the fallback): in the lexicon
    // (so a real word, never an inflected duplicate), not seen or blocked, tier and style switched on, and
    // sensitive words only when their category is on, whether the dataset or the word's labels say so.
    const allowed = (c: Candidate) => {
      const cls = classOf(c.id);
      const flags = lexiconEntry(c.id)?.flags;
      if (!cls || !flags || exclude.has(c.id) || !matchesSettings(cls, current)) return false;
      const s = sensitivity(c);
      return (
        (!(s.vulgar || flags.vulgar) || rude) &&
        (!(s.insulting || flags.insult) || enabled.includes("insult")) &&
        (!flags.sexual || enabled.includes("sexual"))
      );
    };

    // Seeing a word used is half the point, so a word with an example wins; one without is kept as a
    // fallback while the budget lasts, and shown only if nothing better turns up.
    const show = async (found: Word[]) => {
      for (const w of found) {
        const saved = await markSeen(await enrichWord(w));
        if (saved) return saved;
      }
      return null;
    };
    const fallback: Word[] = [];
    let lookups = 0;
    let failed = false;
    let outOfBudget = false;
    for (const category of pick) {
      const fresh = shuffle((await candidates(category)).filter(allowed));
      for (let i = 0; i < fresh.length && !outOfBudget; i += BATCH) {
        if (lookups >= MAX_LOOKUPS) outOfBudget = true;
        else {
          const batch = fresh.slice(i, i + BATCH);
          lookups += batch.length;
          const pending = batch.map((c) =>
            lookup(c, category).then((r) => {
              if (r === "missing") missing.add(c.id);
              else if (r === "failed") failed = true;
              return r;
            }),
          );
          // The first word back with an example wins, so one slow page doesn't hold up the round.
          const first = await Promise.any(pending.map((p) => p.then((r) => (typeof r === "object" && r.example ? r : Promise.reject())))).catch(() => null);
          const saved = first && (await show([first]));
          if (saved) return { status: "ok", word: saved };
          const found = (await Promise.all(pending)).filter((r): r is Word => typeof r === "object");
          const withExample = await show(found.filter((w) => w.example && w !== first)); // only if `first` lost a race
          if (withExample) return { status: "ok", word: withExample };
          fallback.push(...found.filter((w) => !w.example));
        }
      }
      if (outOfBudget) break;
    }
    const saved = await show(fallback);
    if (saved) return { status: "ok", word: saved };
    return { status: failed || outOfBudget ? "error" : "exhausted" };
  } catch (err) {
    console.error("Word discovery failed", err);
    return { status: "error" };
  }
}

// Only fully resolved words get here, so a failed lookup never leaves a half-stored record.
async function markSeen(word: Word): Promise<CollectedWord | null> {
  const now = Date.now();
  const progress = { firstSeenAt: now, lastSeenAt: now, isFavorite: false, learned: false, removedAt: null };
  await words().replaceOne({ _id: word.id }, word, { upsert: true, ignoreUndefined: true });
  // $setOnInsert never touches an existing record: losing a race (two taps, two tabs) returns null and the caller moves on.
  const user: UserWord = { wordId: word.id, ...progress };
  const res = await userWords().updateOne({ _id: word.id }, { $setOnInsert: user }, { upsert: true });
  if (!res.upsertedCount) return null;
  return { ...word, ...classOf(word.id), ...progress };
}

// Your Words: everything seen and not removed, newest first.
export async function getCollection(): Promise<CollectedWord[]> {
  const progress = await userWords().find({ removedAt: null }, { projection: { _id: 0 } }).sort({ firstSeenAt: -1 }).toArray();
  const found = await words()
    .find({ _id: { $in: progress.map((p) => p.wordId) } }, { projection: { _id: 0 } })
    .toArray();
  const byId = new Map(found.map((w) => [w.id, w]));
  return progress.flatMap(({ wordId, ...p }) => {
    const w = byId.get(wordId);
    return w ? [{ ...w, ...classOf(w.id), ...p }] : [];
  });
}

const checkId = (id: unknown) => {
  if (typeof id !== "string" || !id) throw new Error("Invalid word id"); // a non-string _id filter could match other docs
  return id;
};

// Unfavorite and Learned only flip a flag; the word stays seen.
export async function setWordFlag(wordId: string, flag: "isFavorite" | "learned", value: boolean) {
  if ((flag !== "isFavorite" && flag !== "learned") || typeof value !== "boolean") throw new Error("Invalid flag");
  await userWords().updateOne({ _id: checkId(wordId) }, { $set: { [flag]: value } });
}

export async function markViewed(wordId: string) {
  await userWords().updateOne({ _id: checkId(wordId) }, { $set: { lastSeenAt: Date.now() } });
}

// Hidden from Your Words; the record stays, so the word is still seen and never discovered again.
export async function removeFromCollection(wordId: string) {
  await userWords().updateOne({ _id: checkId(wordId) }, { $set: { removedAt: Date.now() } });
}

// Deletes the user's record so the word may be discovered again. The canonical word data is kept as a cache.
export async function forgetWord(wordId: string) {
  await userWords().deleteOne({ _id: checkId(wordId) });
}

// History, favorites, learned states and settings. Practice data lives in other collections and is untouched.
export async function clearVocabularyData() {
  await Promise.all([userWords().deleteMany({}), words().deleteMany({}), settings().deleteMany({})]);
}

export async function getSettings(): Promise<VocabSettings> {
  const doc = await settings().findOne({ _id: "settings" });
  const { settings: current, migrated } = migrateSettings(doc);
  if (migrated) await settings().updateOne({ _id: "settings" }, { $set: current }); // once, so later partial saves build on it
  return current;
}

// Takes only what changed, so toggling a level can't overwrite categories saved a moment earlier (or vice versa).
export async function updateSettings(change: Partial<VocabSettings>) {
  const set: Partial<VocabSettings> = {};
  if (change?.enabled !== undefined) {
    if (!Array.isArray(change.enabled)) throw new Error("Invalid categories");
    set.enabled = [...new Set(change.enabled.filter(isDiscoveryCategory))];
  }
  if (change?.difficulties !== undefined) {
    if (!Array.isArray(change.difficulties)) throw new Error("Invalid levels");
    set.difficulties = [...new Set(change.difficulties.filter(isDifficulty))];
  }
  if (change?.styles !== undefined) {
    if (!Array.isArray(change.styles)) throw new Error("Invalid styles");
    set.styles = [...new Set(change.styles.filter(isStyle))];
  }
  // Always writes the whole document, so a first save can never look like pre-migration settings later.
  // Server actions run one at a time per client, so this read-then-write can't interleave with another toggle.
  const current = await getSettings();
  await settings().updateOne({ _id: "settings" }, { $set: { ...current, ...set } }, { upsert: true });
}
