import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BEYOND_CEFR,
  classLine,
  classify,
  DEFAULT_SETTINGS,
  levelLabel,
  matchesSettings,
  migrateSettings,
  normalizeWord,
  rarityOf,
  tierOf,
  type DiscoveryMode,
  type VocabSettings,
} from "./catalog";
import { categoryWords, classOf, lexiconEntry, wordnetSenses } from "./lexicon";
import { enrichWord, fromWiktionary, fromWordNet, lookupWord, parseDatamuse, sensitivity, toWord } from "./providers";
import stats from "./data/lexicon-stats.json";

const realFetch = globalThis.fetch;
const unpause = () => Object.assign(globalThis, { vocabPausedUntil: {}, vocabFailures: {} });
// Routes each provider's URL to a canned answer; anything unrouted is a 404.
const fakeProviders = (routes: Record<string, unknown>) =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return hit ? Response.json(routes[hit]) : new Response("Not found", { status: 404 });
  }) as unknown as typeof fetch;

test("words are compared case- and punctuation-insensitively", () => {
  for (const s of ["Serendipity", " SERENDIPITY. ", "serendipity", "“serendipity”"]) expect(normalizeWord(s)).toBe("serendipity");
  expect(normalizeWord("Self-Assured!")).toBe("self-assured");
});

test("Datamuse candidates: single real words, not junk-rare, normalized", () => {
  const out = parseDatamuse([
    { word: "Halcyon", tags: ["syn", "adj", "f:0.29"] },
    { word: "halcyon", tags: ["adj", "f:0.29"] },
    { word: "Elysian", tags: ["adj", "prop", "f:0.16"] },
    { word: "well chosen", tags: ["adj", "f:1"] },
    { word: "like", tags: ["adj", "f:611.2"] },
    { word: "paradisaic", tags: ["adj", "f:0.005"] },
    { word: "glad", tags: ["adj"] },
    { nope: true },
  ]);
  expect(out).toEqual([
    { id: "halcyon", pos: "adjective", frequency: 0.29, definitions: [] },
    { id: "halcyon", pos: "adjective", frequency: 0.29, definitions: [] }, // deduped per category by datamuseCandidates
    { id: "like", pos: "adjective", frequency: 611.2, definitions: [] }, // how common is fine is up to the level setting
  ]);
  expect(() => parseDatamuse({ error: "rate limited" })).toThrow();
});
test("dictionary entries become a Word only when there's a usable definition", () => {
  const c = { id: "fool", pos: "noun", definitions: [] };
  const entry = [
    {
      word: "Fool",
      phonetics: [{ text: "/fuːl/", audio: "" }, { audio: "https://example.com/fool.mp3" }],
      meanings: [
        { partOfSpeech: "verb", definitions: [{ definition: "To trick or deceive someone.", example: "You can't fool me." }] },
        {
          partOfSpeech: "noun",
          definitions: [
            { definition: "Plural of fools." },
            { definition: "A person with poor judgment or little intelligence." },
            { definition: "A jester; a person whose role was to entertain.", example: "The king's fool.", synonyms: ["jester", "Fool"] },
          ],
          synonyms: ["idiot", "jester"],
          antonyms: ["sage"],
        },
      ],
    },
  ];
  expect(toWord(c, "insult", entry)).toEqual({
    id: "fool",
    word: "Fool",
    definition: "A jester; a person whose role was to entertain.", // matching sense, and it has an example
    example: "The king's fool.",
    partOfSpeech: "noun",
    pronunciation: "/fuːl/",
    audioUrl: "https://example.com/fool.mp3",
    synonyms: ["jester", "idiot"],
    antonyms: ["sage"],
    discoveryCategories: ["insult"],
  });
  const pointer = [{ meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "Ellipsis of yummy mummy. [(slang) An attractive young mother, often far longer than eighty characters.]" }, { definition: "A form of government in which the people rule." }] }] }];
  expect(toWord(c, "insult", pointer)?.definition).toBe("A form of government in which the people rule.");
  expect(toWord(c, "insult", { title: "No Definitions Found" })).toBeNull();
  expect(toWord(c, "insult", [{ meanings: [{ definitions: [{ definition: "Plural of fool." }, { definition: 42 }] }] }])).toBeNull();
  expect(toWord(c, "insult", [null, "junk"])).toBeNull();
});

// Trimmed from the real response for "ostensible".
const WIKTIONARY_OSTENSIBLE = {
  en: [
    { partOfSpeech: "Proper noun", definitions: [{ definition: "A made-up name sense, long enough to count." }] },
    {
      partOfSpeech: "Adjective",
      definitions: [
        { definition: '<a rel="mw:WikiLink" href="/wiki/apparent">Apparent</a>, evident; meant for open display.' },
        {
          definition: "Appearing as such; being such in appearance; professed, supposed (rather than demonstrably true or real).",
          examples: ["The <b>ostensible</b> reason for his visit was to see his mother &amp; father."],
        },
      ],
    },
  ],
  fr: [{ partOfSpeech: "Adjective", definitions: [{ definition: "apparent, in French" }] }],
};

test("Wiktionary definitions keep their own example, as plain text", () => {
  const c = { id: "ostensible", pos: "adjective", definitions: [] };
  expect(fromWiktionary(c, "confident", WIKTIONARY_OSTENSIBLE)).toMatchObject({
    definition: "Appearing as such; being such in appearance; professed, supposed (rather than demonstrably true or real).",
    example: "The ostensible reason for his visit was to see his mother & father.",
    partOfSpeech: "adjective",
  });
  // One part of speech split over two entries (different etymologies): the sense with an example still wins.
  const split = { en: [{ partOfSpeech: "Adjective", definitions: [{ definition: "Plain first sense, no example here." }] }, { partOfSpeech: "Adjective", definitions: [{ definition: "Later sense that has one.", examples: ["Used here."] }] }] };
  expect(fromWiktionary(c, "confident", split)).toMatchObject({ definition: "Later sense that has one.", example: "Used here." });
  expect(fromWiktionary(c, "confident", { fr: WIKTIONARY_OSTENSIBLE.fr })).toBeNull();
  expect(fromWiktionary(c, "confident", "junk")).toBeNull();
});

test("sensitive words are recognized from the word itself and Wiktionary's labels", () => {
  const word = (id: string, ...labels: string[]) => ({ id, definitions: labels.map((l) => ({ text: "A sense.", labels: l.split(", ") })) });
  expect(sensitivity(word("bitchy", "colloquial"))).toEqual({ vulgar: true, insulting: false }); // the root gives it away
  expect(sensitivity(word("bloody", "informal, mildly vulgar"))).toEqual({ vulgar: true, insulting: false });
  expect(sensitivity(word("moron", "informal, derogatory"))).toEqual({ vulgar: false, insulting: true });
  expect(sensitivity(word("cocksure", "informal"))).toEqual({ vulgar: false, insulting: false });
  expect(sensitivity(word("scathing"))).toEqual({ vulgar: false, insulting: false });
});


test("when the online dictionaries are unreachable, bundled WordNet defines the word, then Datamuse", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  try {
    const [moron] = parseDatamuse([{ word: "moron", tags: ["n", "ipa_pron:mˈɔrɑn", "f:0.35"], defs: ["n\t(informal, derogatory) a stupid person; an idiot. "] }]);
    const fromWn = await lookupWord(moron, "insult");
    expect(typeof fromWn === "object" && fromWn.definition.toLowerCase()).toContain((await wordnetSenses("moron"))[0][1].slice(0, 20));
    // Not in WordNet: Datamuse's own definition, with its Wiktionary labels.
    const [other] = parseDatamuse([{ word: "zorbish", tags: ["n", "f:0.35"], defs: ["n\t(obsolete) Old sense. ", "n\t(informal, derogatory) a stupid person; an idiot. "] }]);
    expect(await lookupWord(other, "insult")).toMatchObject({ definition: "A stupid person; an idiot.", descriptors: ["informal", "derogatory"] });
    expect(await lookupWord({ id: "zorblaxx", definitions: [] }, "insult")).toBe("failed"); // nothing anywhere: retry later
    expect(await lookupWord({ id: "zzmessing", definitions: [{ pos: "noun", text: "A surname from German.", labels: [] }] }, "sarcasm")).toBe("failed");
  } finally {
    globalThis.fetch = realFetch;
    unpause();
  }
});

test("a resolved word gets WordNet relations first, separate senses, labels and recorded audio", async () => {
  globalThis.fetch = fakeProviders({
    "api.dictionaryapi.dev": [{ word: "ostensible", meanings: [] }], // reachable, but nothing usable
    "page/definition/ostensible": WIKTIONARY_OSTENSIBLE,
    "rel_syn=ostensible": [{ word: "apparent" }, { word: "professed" }],
    "rel_ant=ostensible": [],
    "page/media-list/ostensible": { items: [{ title: "File:LL-Q150_(fra)-x-ostensible.wav", type: "audio" }, { title: "File:ostensible-us-pron.ogg", type: "audio" }] },
  });
  try {
    const [c] = parseDatamuse([{ word: "ostensible", tags: ["adj", "f:0.9"], defs: ["adj\t(formal) Appearing as such; being such in appearance; professed, supposed. "] }]);
    const word = await lookupWord(c, "general");
    if (typeof word !== "object") throw new Error(word);
    expect(await enrichWord(word)).toMatchObject({
      example: "The ostensible reason for his visit was to see his mother & father.", // Wiktionary: same sense as the definition
      descriptors: ["formal"],
      synonyms: ["apparent", "seeming", "ostensive", "professed"], // WordNet (both adjective senses), then Datamuse
      relatedWords: ["superficial"],
      otherSenses: [{ partOfSpeech: "adjective", definition: "Represented or appearing as such; pretended." }], // kept apart, not merged
      audioUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d7/Ostensible-us-pron.ogg/Ostensible-us-pron.ogg.mp3",
    });
  } finally {
    globalThis.fetch = realFetch;
    unpause();
  }
});

test("WordNet senses: glosses become sentences, the matching part of speech comes first", async () => {
  const senses = await wordnetSenses("threnody");
  expect(senses[0][1]).toContain("mourning");
  expect(senses[0][3]).toContain("dirge");
  const w = fromWordNet({ id: "threnody", pos: "noun", definitions: [] }, "general", senses);
  expect(w?.definition).toMatch(/^A song or hymn of mourning.*\.$/);
  expect(w?.synonyms).toContain("dirge");
});

// ---------- classification: CEFR, rarity and style are separate dimensions ----------

test("rarity comes from wordfreq zipf, with documented steps", () => {
  expect([5, 4, 3.99, 3, 2, 1.99, 1.5, 1.49, 0].map(rarityOf)).toEqual(["very_common", "very_common", "common", "common", "uncommon", "rare", "rare", "very_rare", "very_rare"]);
});

test("CEFR decides the tier when known; rarity only beyond the lists", () => {
  expect(tierOf("A1", "very_rare")).toBe("easy"); // a CEFR level is never overridden by frequency
  expect(tierOf("C2", "very_rare")).toBe("advanced");
  expect(tierOf(undefined, "uncommon")).toBe("c2_plus");
  expect(tierOf(undefined, "rare")).toBe("rare");
  expect(tierOf(undefined, "very_rare")).toBe("very_rare");
  expect(tierOf(undefined, "common")).toBe("hard"); // unrated common word: a tier for filtering, never a CEFR label
});

test("C2+ is never presented as an official CEFR level, and estimates are marked", () => {
  const beyond = classify({ zipf: 1.2, styleBits: 2 });
  expect(beyond.level).toBeUndefined();
  expect(levelLabel(beyond)).toBe("C2+");
  expect(classLine(beyond)).toEqual(["C2+", "Very rare", "Poetic"]);
  expect(classLine(classify({ cefr: "C2", cefrSource: "octanove", zipf: 1.7, styleBits: 1 }))).toEqual(["C2", "Rare", "Literary"]);
  expect(levelLabel(classify({ cefr: "B2", cefrSource: "words-cefr", zipf: 3.2, styleBits: 0 }))).toBe("≈B2");
  expect(levelLabel(classify({ zipf: 3.5, styleBits: 0 }))).toBeUndefined(); // unrated common word: no level shown
  const labels = [0.5, 1, 1.7, 2.5, 3.5, 4.5].flatMap((z) => [0, 1, 2, 4, 8, 16].map((b) => levelLabel(classify({ zipf: z, styleBits: b }))));
  expect(labels.filter((l) => l !== undefined && l !== "C2+")).toEqual([]);
});

test("tier and style filters don't interfere: a word can be C2 + poetic, or C2+ + rare + poetic", () => {
  const settings = (difficulties: VocabSettings["difficulties"], styles: VocabSettings["styles"]) => ({ difficulties, styles });
  const easyEveryday = classify({ cefr: "A2", cefrSource: "cefrj", zipf: 5, styleBits: 0 });
  const c2Poetic = classify({ cefr: "C2", cefrSource: "octanove", zipf: 2.5, styleBits: 2 });
  const rarePoetic = classify({ zipf: 1.6, styleBits: 3 });
  const hard = classify({ cefr: "C1", cefrSource: "octanove", zipf: 3, styleBits: 0 });
  const easyOnly = settings(["easy"], DEFAULT_SETTINGS.styles);
  for (const w of [c2Poetic, rarePoetic, hard]) expect(matchesSettings(w, easyOnly)).toBe(false); // Easy never gives C1/C2/C2+
  expect(matchesSettings(easyEveryday, easyOnly)).toBe(true);
  const poeticOnly = settings(DEFAULT_SETTINGS.difficulties, ["poetic"]);
  expect([easyEveryday, c2Poetic, rarePoetic, hard].map((w) => matchesSettings(w, poeticOnly))).toEqual([false, true, true, false]);
  // Switching styles never changes a word's tier, and vice versa.
  expect(classify({ zipf: 1.6, styleBits: 0 }).tier).toBe(rarePoetic.tier);
  expect(matchesSettings(rarePoetic, settings(["advanced"], ["poetic"]))).toBe(false);
  expect(matchesSettings(c2Poetic, settings(["advanced"], ["poetic"]))).toBe(true);
  expect(matchesSettings(rarePoetic, settings(BEYOND_CEFR, ["poetic"]))).toBe(true);
  const advanced = settings(["advanced", ...BEYOND_CEFR], DEFAULT_SETTINGS.styles);
  expect([c2Poetic, rarePoetic].every((w) => matchesSettings(w, advanced))).toBe(true);
});

test("settings saved before the lexicon are migrated with safe defaults", () => {
  expect(migrateSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, migrated: false });
  expect(migrateSettings({ enabled: ["sad", "cuss"], difficulties: ["hard", "advanced"] })).toEqual({
    migrated: true,
    settings: { enabled: ["sad", "cuss", "general"], difficulties: ["hard", "advanced", "c2_plus", "rare", "very_rare"], styles: ["everyday", "formal", "literary", "poetic"] },
  });
  expect(migrateSettings({ enabled: ["sad"], difficulties: ["easy"] }).settings.difficulties).toEqual(["easy"]); // didn't have Advanced, doesn't get rare words
  const current: VocabSettings = { enabled: ["sad"], difficulties: ["rare"], styles: ["poetic"] };
  expect(migrateSettings(current)).toEqual({ settings: current, migrated: false });
});

// ---------- the generated lexicon ----------

test("CEFR follows the documented precedence, with sources kept", () => {
  expect(classOf("happy")).toMatchObject({ level: "A1", cefrSource: "cefrj", tier: "easy" });
  expect(classOf("timid")).toMatchObject({ level: "C1", cefrSource: "octanove", tier: "hard" });
  expect(classOf("ostensible")).toMatchObject({ level: "C2", cefrSource: "octanove", tier: "advanced" });
  expect(classOf("abandon")?.cefrSource).toBe("cefrj"); // also rated by Words-CEFR, but CEFR-J comes first
  expect(classOf("ethereal")).toMatchObject({ level: "B2", cefrSource: "words-cefr" }); // only an estimate exists
  expect(classOf("threnody")).toMatchObject({ level: undefined, tier: "rare", rarity: "rare" });
  for (const w of ["spendable", "heroical"]) expect(classOf(w)?.level).toBeUndefined(); // "easy" estimates on rare words dropped
  expect(BEYOND_CEFR).toContain(classOf("spendable")!.tier); // still offered, as the rare word it is
  expect(classOf("heroical")).toBeUndefined(); // with the bogus estimate gone, no evidence is left: dropped as noise
});

test("rare, literary and poetic words are classified from the data, not a hard-coded list", () => {
  expect(classOf("susurrus")).toMatchObject({ tier: "very_rare", styles: ["literary"] }); // unknown to wordfreq, kept for its label
  expect(classLine(classOf("halcyon")!)).toEqual(["C2+", "Poetic"]);
  for (const w of ["evanescent", "gossamer", "sepulchral", "ineluctable", "lachrymose", "peregrination", "transience"]) {
    expect(BEYOND_CEFR).toContain(classOf(w)!.tier);
  }
  expect(stats.kept).toBeGreaterThan(50_000);
  expect(stats["style:poetic"]).toBeGreaterThan(150);
  expect(stats["style:literary"]).toBeGreaterThan(150);
});

test("noise is filtered: inflections, spelling duplicates, grammar words, phrases", () => {
  for (const w of ["saddening", "colour", "the", "according to", "California"]) expect(classOf(w)).toBeUndefined();
  expect(classOf("color")).toBeDefined();
  expect(classOf("mortgagor")?.styles).toContain("technical"); // legal jargon, flagged by its book skew
  expect(lexiconEntry("deplorable")?.flags.insult).toBe(true);
  expect(lexiconEntry("shit")?.flags.vulgar).toBe(true);
});

// ---------- discovery against MongoDB ----------
// The real server actions, the real lexicon, fake online providers. Point it at a THROWAWAY server; it deletes all
// vocabulary data in that server's "mathme" database:
//   mongod --dbpath /tmp/vocab-test --port 27018 &
//   VOCAB_TEST_MONGODB_URI=mongodb://127.0.0.1:27018 bun test
const uri = process.env.VOCAB_TEST_MONGODB_URI;

describe.skipIf(!uri)("discovery and history (MongoDB)", () => {
  let api: typeof import("./actions");
  let dictionariesDown = false;
  let datamuseDown = false;

  // Datamuse: every query (disabled categories' too) returns "doleful", a real word in the "sad" lexicon pool, so it
  // must stay blocked. "sad" queries also return "LACHRYMOSE": in the lexicon but not in "sad", so it arrives only
  // through Datamuse, in capitals. The dictionary defines everything; two words come back without an example.
  const NO_EXAMPLE = ["despond", "somberness"];
  const fakeFetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "api.datamuse.com") {
      if (datamuseDown) throw new TypeError("fetch failed");
      const seed = url.searchParams.get("ml");
      if (!seed) return Response.json([]);
      const tags = ["adj", "f:1"];
      return Response.json([{ word: "doleful", tags }, ...(seed === "sad" ? [{ word: "LACHRYMOSE", tags }] : [])]);
    }
    if (dictionariesDown) throw new TypeError("fetch failed");
    const word = decodeURIComponent(url.pathname.split("/").pop()!);
    if (url.hostname !== "api.dictionaryapi.dev") return new Response("Not found", { status: 404 });
    const example = NO_EXAMPLE.includes(word) ? undefined : `Such a ${word} day.`;
    return Response.json([{ word, meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: `A test meaning of ${word}.`, example }] }] }]);
  };

  const drain = async (mode: DiscoveryMode) => {
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const r = await api.getNextWord(mode);
      if (r.status !== "ok") return { ids, last: r.status };
      ids.push(r.word.id);
    }
    throw new Error("discovery never ran out");
  };
  // The server keeps only caches in memory; dropping them is what a restart or reload looks like to it.
  const restart = () => {
    const g = globalThis as { vocabPools?: Map<unknown, unknown>; vocabMissing?: Set<unknown>; vocabResolved?: Map<unknown, unknown> };
    g.vocabPools?.clear();
    g.vocabMissing?.clear();
    g.vocabResolved?.clear();
    unpause();
  };
  const set = (s: Partial<VocabSettings>) => api.updateSettings(s);
  // The "sad" pool for the given tiers, straight from the lexicon (sensitive words and the blocked word left out).
  const sadPool = (tiers: string[]) =>
    [...new Set([...categoryWords("sad"), "lachrymose"])].filter((w) => {
      const e = lexiconEntry(w)!;
      return tiers.includes(classOf(w)!.tier) && !e.flags.vulgar && !e.flags.insult && !e.flags.sexual && w !== "doleful";
    });

  beforeAll(async () => {
    // Bun hasn't implemented v8.startupSnapshot, which the bson package probes on load. Node never reads this shim.
    (await import("node:v8")).default.startupSnapshot.isBuildingSnapshot = () => false;
    process.env.MONGODB_URI = uri;
    globalThis.fetch = fakeFetch as typeof fetch;
    api = await import("./actions");
  });
  beforeEach(async () => {
    dictionariesDown = false;
    datamuseDown = false;
    restart();
    await api.clearVocabularyData();
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  test("random never repeats, stays in its pool, and never returns a disabled category's word", async () => {
    await set({ enabled: ["sad"], difficulties: ["rare", "very_rare"], styles: ["everyday", "formal", "literary", "poetic", "archaic", "technical"] });
    const { ids, last } = await drain("random");
    expect(last).toBe("exhausted");
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(sadPool(["rare", "very_rare"]).sort());
    expect(ids).toContain("lachrymose"); // via Datamuse, normalized from "LACHRYMOSE"
    expect(ids).not.toContain("doleful"); // a disabled category's query returned it
    const words = await api.getCollection();
    expect(words.every((w) => (w.tier === "rare" || w.tier === "very_rare") && w.level === undefined && classLine(w)[0] === "C2+")).toBe(true);
  });

  test("a word with an example beats one without, and the rest still get shown", async () => {
    await set({ enabled: ["sad"], difficulties: ["rare", "very_rare"] });
    const first = await api.getNextWord("sad");
    if (first.status !== "ok") throw new Error(first.status);
    expect(first.word.example).toBeTruthy();
    const { ids } = await drain("sad");
    expect([first.word.id, ...ids].sort()).toEqual(sadPool(["rare", "very_rare"]).sort());
  });

  test("Easy never returns C1/C2/C2+ words; no tiers at all says so", async () => {
    await set({ enabled: ["sad"], difficulties: ["easy"] });
    const { ids, last } = await drain("random");
    expect(last).toBe("exhausted");
    expect(ids.length).toBeGreaterThan(3);
    for (const w of await api.getCollection()) expect(["A1", "A2"]).toContain(w.level!);
    await set({ difficulties: [] });
    expect((await api.getNextWord("random")).status).toBe("no-levels");
  });

  test("style is its own filter: poetic words of any tier, C2+ poetic words, and no styles", async () => {
    await set({ enabled: ["general"], styles: ["poetic"] });
    for (let i = 0; i < 4; i++) {
      const r = await api.getNextWord("general");
      expect(r.status === "ok" && r.word.styles).toContain("poetic");
    }
    await set({ difficulties: ["c2_plus", "rare", "very_rare"] });
    for (let i = 0; i < 3; i++) {
      const r = await api.getNextWord("random");
      if (r.status !== "ok") throw new Error(r.status);
      expect(r.word.styles).toContain("poetic");
      expect(BEYOND_CEFR).toContain(r.word.tier!);
      expect(classLine(r.word)[0]).toBe("C2+");
    }
    await set({ styles: [] });
    expect((await api.getNextWord("random")).status).toBe("no-styles");
  });

  test("sensitive words from the lexicon stay out until their category is on", async () => {
    await set({ enabled: ["sad"], difficulties: ["hard"] });
    expect((await drain("sad")).ids).not.toContain("deplorable"); // flagged insult by Wiktionary
    await set({ enabled: ["sad", "insult"] });
    expect((await drain("sad")).ids).toContain("deplorable");
  });

  test("unfavorite and remove keep a word seen; forget and clear make it eligible again", async () => {
    await set({ enabled: ["sad"], difficulties: ["rare", "very_rare"] });
    const pool = sadPool(["rare", "very_rare"]);
    const [a, b] = (await drain("sad")).ids;

    await api.setWordFlag(a, "isFavorite", true);
    restart();
    expect((await api.getCollection()).find((w) => w.id === a)?.isFavorite).toBe(true);
    await api.setWordFlag(a, "isFavorite", false);
    expect((await api.getNextWord("sad")).status).toBe("exhausted");

    await api.removeFromCollection(a);
    expect((await api.getCollection()).map((w) => w.id)).not.toContain(a);
    expect((await api.getNextWord("sad")).status).toBe("exhausted");

    await api.forgetWord(b);
    const again = await api.getNextWord("sad");
    expect(again.status === "ok" && again.word.id).toBe(b);

    await api.clearVocabularyData(); // settings reset too
    await set({ enabled: ["sad"], difficulties: ["rare", "very_rare"] });
    expect((await drain("sad")).ids).toHaveLength(pool.length);
  });

  test("settings persist, save partially, and legacy settings are migrated once", async () => {
    expect(await api.getSettings()).toEqual(DEFAULT_SETTINGS);
    await set({ difficulties: ["advanced"] });
    restart();
    expect(await api.getSettings()).toEqual({ ...DEFAULT_SETTINGS, difficulties: ["advanced"] }); // a first save stores everything
    expect((await api.getNextWord("cuss")).status).toBe("no-categories");

    const { mongoDb } = await import("@/lib/mongo-db");
    const col = mongoDb().collection<{ _id: string }>("vocab_settings");
    await col.replaceOne({ _id: "settings" }, { enabled: ["sad"], difficulties: ["advanced"] }); // saved by the previous version
    expect(await api.getSettings()).toEqual({ enabled: ["sad", "general"], difficulties: ["advanced", "c2_plus", "rare", "very_rare"], styles: DEFAULT_SETTINGS.styles });
    expect(await col.findOne({ _id: "settings" })).toMatchObject({ styles: DEFAULT_SETTINGS.styles }); // written back
    await set({ styles: ["poetic"] });
    expect(await api.getSettings()).toMatchObject({ difficulties: ["advanced", "c2_plus", "rare", "very_rare"], styles: ["poetic"] });
    await expect(set({ styles: "poetic" } as never)).rejects.toThrow();
  });

  test("dictionary outages fall back to WordNet; a Datamuse outage stores nothing and recovers on retry", async () => {
    await set({ enabled: ["sad"], difficulties: ["rare", "very_rare"] });
    dictionariesDown = true;
    const offline = await api.getNextWord("sad");
    if (offline.status !== "ok") throw new Error(offline.status);
    expect(offline.word.definition).not.toContain("A test meaning"); // from the bundled WordNet senses

    restart();
    datamuseDown = true;
    const before = (await api.getCollection()).length;
    expect((await api.getNextWord("sad")).status).toBe("error"); // can't verify disabled categories: fail closed
    expect((await api.getCollection()).length).toBe(before);
    datamuseDown = false;
    expect((await api.getNextWord("sad")).status).toBe("ok");
  });
});
