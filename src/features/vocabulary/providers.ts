// Word sources, server-side only. Nothing outside this file knows the Datamuse, dictionaryapi.dev, Wiktionary,
// Commons or WordNet formats: they come out as Candidates and Words. Replacing a provider means editing this file.
import { createHash } from "node:crypto";
import { normalizeWord, type DiscoveryCategory, type Word } from "./catalog";
import seeds from "./data/category-seeds.json";
import { wordnetSenses, type WordNetSense } from "./lexicon";

// Datamuse's own definitions (Wiktionary/WordNet, with usage labels) ride along with every candidate.
type Sense = { pos?: string; text: string; labels: string[] };
export type Candidate = { id: string; pos?: string; frequency?: number; pronunciation?: string; definitions: Sense[] };

// Every per-word source has a fallback, so timeouts are short. dictionaryapi.dev answers from its cache at once
// or hangs; uncached Wiktionary pages really do take a few seconds.
const POOL_TIMEOUT_MS = 12_000; // once per server process: a cold start fetches every category's pool at once
const DICTIONARY_TIMEOUT_MS = 3000;
const WIKTIONARY_TIMEOUT_MS = 7000;
const EXTRAS_TIMEOUT_MS = 2500; // synonyms and audio are nice to have; don't hold the word back for them
const PAUSE_MS = 60_000; // after a source keeps failing, skip it for a while instead of timing out on every word
const PAUSE_AFTER = 3; // failures in a row: one slow page isn't an outage
const WIKI_HEADERS = { "User-Agent": "mathme/0.1 (personal vocabulary trainer)" }; // Wikimedia asks clients to identify themselves

// Datamuse "means like" queries per category, hand-picked by checking what each returns at every level. Shared
// with the dataset build, which expands the same seeds through WordNet. General has none: it's lexicon-only.
// Avoid seeds with common other meanings: "kind" brings sort/type/form, "tender" brings young/offer/bid.
// ponytail: Datamuse similarity is fuzzy, so a few off-topic words get through; a curated list is the upgrade.
const SEEDS: Record<DiscoveryCategory, string[]> = seeds;

const DATAMUSE_POS: Record<string, string> = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };

export async function datamuseCandidates(category: DiscoveryCategory): Promise<Candidate[]> {
  const lists = await Promise.all(
    SEEDS[category].map(async (seed) => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(seed)}&md=fpdr&ipa=1&max=40`, {
            signal: AbortSignal.timeout(POOL_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`Datamuse ${res.status}`);
          return parseDatamuse(await res.json());
        } catch (err) {
          if (attempt) throw err; // one retry: a cold start sends every request at once, and one blip would fail it all
        }
      }
    }),
  );
  return [...new Map(lists.flat().map((c) => [c.id, c])).values()];
}

// Backs up the category rule using the word itself, whichever query found it: profanity roots and Wiktionary's
// own vulgar/derogatory labels on any sense. Datamuse's "sarcasm" query can return "bitchy", for instance.
// ponytail: a short root list, not a full profanity filter; it over-blocks a few innocent words (pussyfoot, retardant).
const PROFANE = /fuck|shit|cunt|bitch|whore|slut|wank|twat|bollock|piss|bastard|asshole|dickhead|cocksuck|jizz|tits|titty|boob|pussy|douche|retard|fag|nigg(er|a)/;
export function sensitivity(c: Candidate) {
  const labels = c.definitions.flatMap((d) => d.labels);
  return {
    vulgar: PROFANE.test(c.id) || labels.some((l) => l.includes("vulgar")),
    insulting: labels.some((l) => /offensive|derogatory|slur/.test(l)),
  };
}

// Wiktionary prefixes senses with usage labels: "(informal, derogatory) A stupid person."
const LABEL = /^\(([^)]*)\)\s*/;

export function parseDatamuse(json: unknown): Candidate[] {
  if (!Array.isArray(json)) throw new Error("Unexpected Datamuse response");
  return json.flatMap((item) => {
    if (typeof item?.word !== "string") return [];
    const tags: string[] = Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === "string") : [];
    const id = normalizeWord(item.word);
    if (tags.includes("prop") || !/^[a-z]{3,}(-[a-z]+)?$/.test(id)) return []; // single real words, no names or phrases
    const frequency = Number(tags.find((t) => t.startsWith("f:"))?.slice(2));
    if (!(frequency >= 0.05)) return []; // near-unknown junk; how common a word may be is the level setting's call
    const pos = tags.map((t) => DATAMUSE_POS[t]).find(Boolean);
    const ipa = tags.find((t) => t.startsWith("ipa_pron:"))?.slice(9).trim();
    const definitions = (Array.isArray(item.defs) ? item.defs : []).flatMap((d: unknown): Sense[] => {
      const [p = "", raw = ""] = typeof d === "string" ? d.split("\t") : [];
      const labels = (raw.trim().match(LABEL)?.[1] ?? "").split(",").map((l) => l.trim().toLowerCase());
      const text = raw.trim().replace(LABEL, "");
      return text ? [{ pos: DATAMUSE_POS[p], text, labels }] : [];
    });
    return [{ id, pos, frequency, pronunciation: ipa ? `/${ipa}/` : undefined, definitions }];
  });
}

const g = globalThis as { vocabPausedUntil?: Record<string, number>; vocabFailures?: Record<string, number> };

// A source that may be down. "missing" = it answered 404. "failed" = unreachable, slow, rate limited, erroring
// or malformed; a few of those in a row and the source is skipped for a minute.
async function getJson(source: string, url: string, timeoutMs: number, headers?: Record<string, string>): Promise<{ json: unknown } | "missing" | "failed"> {
  const paused = (g.vocabPausedUntil ??= {});
  const failures = (g.vocabFailures ??= {});
  if (Date.now() < (paused[source] ?? 0)) return "failed";
  let reason: unknown;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok || res.status === 404) {
      const json = res.ok ? await res.json() : null;
      failures[source] = 0;
      return res.ok ? { json } : "missing";
    }
    reason = `HTTP ${res.status}`;
    if (res.status === 429) failures[source] = PAUSE_AFTER; // asked to back off: pause now
  } catch (err) {
    reason = err instanceof Error ? err.name : err;
  }
  failures[source] = (failures[source] ?? 0) + 1;
  if (failures[source] >= PAUSE_AFTER) paused[source] = Date.now() + PAUSE_MS;
  console.warn(`Word source ${source} failed (${reason})${failures[source] >= PAUSE_AFTER ? ", pausing it for a minute" : ""}`);
  return "failed";
}

// A definition and its example must describe the same sense, so both come from one source, tried in order:
// dictionaryapi.dev (also brings IPA, audio, synonyms), Wiktionary (often has an example), Open English WordNet
// (bundled, so it works when the others are down or rate-limited), Datamuse's own definitions.
// "missing": nobody has a usable definition, so never try this word again. "failed": worth retrying later.
export async function lookupWord(c: Candidate, category: DiscoveryCategory): Promise<Word | "missing" | "failed"> {
  let word: Word | null = null;
  const dict = await getJson("dictionary", `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(c.id)}`, DICTIONARY_TIMEOUT_MS);
  if (typeof dict === "object") word = toWord(c, category, dict.json);
  let wikt: Awaited<ReturnType<typeof getJson>> = "missing";
  if (!word) {
    const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(c.id)}`;
    wikt = await getJson("wiktionary", url, WIKTIONARY_TIMEOUT_MS, WIKI_HEADERS);
    if (typeof wikt === "object") word = fromWiktionary(c, category, wikt.json);
  }
  word ??= fromWordNet(c, category, await wordnetSenses(c.id)) ?? fromDatamuse(c, category);
  if (word) return { ...word, descriptors: labelsFor(c, word.definition) };
  return dict === "failed" || wikt === "failed" ? "failed" : "missing";
}

// Extras for the word that will be shown; any source failing just leaves that field as it was.
// Lexical relations by precedence: Open English WordNet for the shown part of speech, then the dictionary's own,
// then Datamuse. WordNet's other meanings are kept as separate senses, never merged into the shown one.
export async function enrichWord(w: Word): Promise<Word> {
  const [senses, synonyms, antonyms, audioUrl] = await Promise.all([
    wordnetSenses(w.id),
    related("rel_syn", w.id),
    related("rel_ant", w.id),
    w.audioUrl ?? commonsAudio(w.id),
  ]);
  const samePos = senses.filter((s) => WORDNET_POS[s[0]] === w.partOfSpeech);
  const main = samePos[0] ?? senses[0]; // the WordNet sense most likely to be the one shown
  const merge = (...lists: string[][]) => [...new Set(lists.flat())].filter((x) => normalizeWord(x) !== w.id).slice(0, 8);
  const otherSenses = senses
    .filter((s) => s !== main && wording(s[1]) !== wording(w.definition))
    .slice(0, 4)
    .map(([pos, definition]) => ({ partOfSpeech: WORDNET_POS[pos], definition: sentence(definition) }));
  return {
    ...w,
    synonyms: merge(samePos.slice(0, 2).flatMap((s) => s[3]), w.synonyms, synonyms),
    antonyms: merge(samePos.flatMap((s) => s[4]), w.antonyms, antonyms),
    relatedWords: main?.[5].length ? main[5] : undefined,
    otherSenses: otherSenses.length ? otherSenses : undefined,
    audioUrl,
  };
}

async function related(rel: "rel_syn" | "rel_ant", id: string): Promise<string[]> {
  const res = await getJson("datamuse-related", `https://api.datamuse.com/words?${rel}=${encodeURIComponent(id)}&max=8`, EXTRAS_TIMEOUT_MS);
  return typeof res === "object" ? records(res.json).map((r) => str(r.word)).filter((s): s is string => !!s) : [];
}

// A recorded English pronunciation from Wikimedia Commons, linked as the MP3 that Commons transcodes every
// recording to (Safari can't play the original Ogg). The transcode path comes from the file name's MD5.
const ENGLISH_AUDIO = /^File:(en-[a-z]{2}-|LL-Q1860[ _]|.+-(us|uk|au)-pron\.)/i;
async function commonsAudio(id: string): Promise<string | undefined> {
  const url = `https://en.wiktionary.org/api/rest_v1/page/media-list/${encodeURIComponent(id)}`;
  const res = await getJson("wiktionary-media", url, EXTRAS_TIMEOUT_MS, WIKI_HEADERS); // its own pause: a slow list mustn't stop definitions
  if (typeof res !== "object") return undefined;
  const title = records(obj(res.json).items)
    .filter((i) => i.type === "audio")
    .map((i) => str(i.title))
    .find((t) => t && ENGLISH_AUDIO.test(t));
  if (!title) return undefined;
  const name = title.slice(5).replace(/ /g, "_");
  const file = name[0].toUpperCase() + name.slice(1); // Commons capitalizes the first letter
  const md5 = createHash("md5").update(file).digest("hex");
  const f = encodeURIComponent(file);
  return `https://upload.wikimedia.org/wikipedia/commons/transcoded/${md5[0]}/${md5.slice(0, 2)}/${f}/${f}.mp3`;
}

const WORDNET_POS: Record<string, string> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
const sentence = (s: string) => s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

// Open English WordNet senses (glosses are lowercase fragments: "a song or hymn of mourning…"). The build kept
// an example only when it actually uses the word.
export function fromWordNet(c: Candidate, category: DiscoveryCategory, senses: WordNetSense[]): Word | null {
  const choices = senses.map(([pos, definition, examples, synonyms, antonyms]) => ({ pos: WORDNET_POS[pos], definition: sentence(definition), example: examples[0], synonyms, antonyms }));
  const sense = chooseSense(choices, c.pos);
  if (!sense) return null;
  return {
    id: c.id,
    word: c.id,
    definition: sense.definition,
    example: sense.example,
    partOfSpeech: sense.pos,
    pronunciation: c.pronunciation,
    synonyms: uniqueOthers(sense.synonyms, c.id),
    antonyms: uniqueOthers(sense.antonyms, c.id),
    discoveryCategories: [category],
  };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);
const records = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// "Plural of fool.", "Alternative spelling of cosy." or "Ellipsis of yummy mummy." only points at another entry
// ("A form of government…" is a real definition, hence no leading article). "A surname from German." or
// "A commune in Haiti." is a name, not vocabulary.
const POINTER = /^(?!(a|an|the) )([a-z-]+ ){0,6}(form|spelling|misspelling|participle|plural|tense|singular|comparative|superlative|ellipsis|abbreviation|initialism|acronym|clipping) of\b/i;
const NAME = /\b(surname|given name|place ?name|commune|municipality|census-designated|unincorporated)\b|^an? (city|town|village|river|county|province|island|hamlet) (in|of)\b/i;
const isUseful = (d: string | undefined): d is string => !!d && d.length >= 12 && !POINTER.test(d) && !(d.length < 80 && NAME.test(d));

// Picks the sense to show from [part of speech, definition, example] triples. Proper nouns never; the part of
// speech Datamuse matched the category on comes first; within the leading part of speech, a sense with an
// example beats the first sense (dictionaries split one part of speech across several entries).
type Choice = { pos?: string; definition: string; example?: string };
function chooseSense<T extends Choice>(senses: T[], pos?: string): T | undefined {
  const usable = senses.filter((s) => s.pos !== "proper noun" && isUseful(s.definition));
  const ordered = [...usable.filter((s) => s.pos === pos), ...usable.filter((s) => s.pos !== pos)];
  return ordered.find((s) => s.example && s.pos === ordered[0].pos) ?? ordered[0];
}
const uniqueOthers = (xs: string[], id: string) => [...new Set(xs)].filter((x) => normalizeWord(x) !== id).slice(0, 8);

// dictionaryapi.dev entries → Word, or null when there's no usable definition.
export function toWord(c: Candidate, category: DiscoveryCategory, json: unknown): Word | null {
  const entries = records(json);
  const senses = entries
    .flatMap((e) => records(e.meanings))
    .flatMap((m) =>
      records(m.definitions).map((d) => ({
        pos: str(m.partOfSpeech)?.toLowerCase(),
        definition: str(d.definition) ?? "",
        example: str(d.example),
        synonyms: [...strings(d.synonyms), ...strings(m.synonyms)],
        antonyms: [...strings(d.antonyms), ...strings(m.antonyms)],
      })),
    );
  const sense = chooseSense(senses, c.pos);
  if (!sense) return null;
  const phonetics = entries.flatMap((e) => records(e.phonetics));
  const spelled = str(entries[0].word);
  return {
    id: c.id,
    word: spelled && normalizeWord(spelled) === c.id ? spelled : c.id,
    definition: sense.definition,
    example: sense.example,
    partOfSpeech: sense.pos,
    pronunciation: entries.map((e) => str(e.phonetic)).find(Boolean) ?? phonetics.map((p) => str(p.text)).find(Boolean) ?? c.pronunciation,
    audioUrl: phonetics.map((p) => str(p.audio)).find((a) => a?.startsWith("https://")),
    synonyms: uniqueOthers(sense.synonyms, c.id),
    antonyms: uniqueOthers(sense.antonyms, c.id),
    discoveryCategories: [category],
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();

// Wiktionary REST definitions: HTML glosses with their own examples (usage labels are stripped).
export function fromWiktionary(c: Candidate, category: DiscoveryCategory, json: unknown): Word | null {
  const senses = records(obj(json).en).flatMap((m) =>
    records(m.definitions).map((d) => ({
      pos: str(m.partOfSpeech)?.toLowerCase(),
      definition: plain(str(d.definition) ?? ""),
      example: strings(d.examples).map(plain).find(Boolean),
    })),
  );
  const sense = chooseSense(senses, c.pos);
  if (!sense) return null;
  return {
    id: c.id,
    word: c.id,
    definition: sense.definition,
    example: sense.example,
    partOfSpeech: sense.pos,
    pronunciation: c.pronunciation,
    synonyms: [],
    antonyms: [],
    discoveryCategories: [category],
  };
}

function fromDatamuse(c: Candidate, category: DiscoveryCategory): Word | null {
  const defs = c.definitions.filter((d) => isUseful(d.text) && !d.labels.includes("obsolete"));
  const def = defs.find((d) => d.pos === c.pos) ?? defs[0];
  if (!def) return null;
  return {
    id: c.id,
    word: c.id,
    definition: def.text[0].toUpperCase() + def.text.slice(1), // WordNet senses start lowercase
    partOfSpeech: def.pos,
    pronunciation: c.pronunciation,
    synonyms: [],
    antonyms: [],
    discoveryCategories: [category],
  };
}

// Register labels ("formal", "slang"…) for the chosen sense. All three definition sources are Wiktionary text,
// so the matching Datamuse sense is found by its wording; its labels are the ones Wiktionary gives that sense.
const DESCRIPTORS = new Set(["formal", "informal", "colloquial", "slang", "literary", "poetic", "archaic", "dated", "rare", "technical", "figurative", "humorous", "derogatory", "offensive", "vulgar", "euphemistic"]);
const wording = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 40);
function labelsFor(c: Candidate, definition: string) {
  const labels = c.definitions.find((d) => wording(d.text) === wording(definition))?.labels.filter((l) => DESCRIPTORS.has(l)) ?? [];
  return labels.length ? labels : undefined;
}
