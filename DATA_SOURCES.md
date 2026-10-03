# Vocabulary data sources

The vocabulary feature's word data is built from free/open resources by `scripts/build-vocabulary-dataset.py`. No commercial
dictionary (Oxford, Cambridge, Merriam-Webster…) is used or scraped.

**Bundled output** (generated, never edited by hand) is in `src/features/vocabulary/data/`:

- `lexicon.json`: one row per word: CEFR level and its source, wordfreq zipf, style bits, sensitivity bits, categories and WordNet parts of speech. 53,281 words, 2.1 MB.
- `senses/*.json`: WordNet senses (gloss, examples, synonyms, antonyms, related words), one file per first letter, 13 MB, loaded lazily.
- `lexicon-stats.json`: counts and distributions from the last build.

All of it is server-only: it never reaches the browser bundle.

Because the output includes CC BY-SA material (Octanove, wordfreq, Wiktionary labels), **the generated dataset is
distributed under CC BY-SA 4.0**, with the attributions below.

| Source | What is used | License | Bundled |
|---|---|---|---|
| [CEFR-J Vocabulary Profile 1.5](https://github.com/openlanguageprofiles/olp-en-cefrj) (commit `d4e45b7`) | CEFR level A1–B2 per headword | Free for research and commercial use with citation; © Tono Laboratory, TUFS | Derived levels |
| [Octanove Vocabulary Profile C1/C2 1.0](https://github.com/openlanguageprofiles/olp-en-cefrj) (same commit) | CEFR level C1–C2 per headword | CC BY-SA 4.0, Octanove Labs | Derived levels |
| [Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset) (commit `c05858c`) | Computed CEFR estimates (fallback); Google Books 1-gram counts | MIT, © 2024 Belikov Maxim | Derived levels; counts used at build time only |
| [wordfreq 3.1.1](https://github.com/rspeer/wordfreq) | Zipf frequency (`wordlist="large"`), 50 most common words | Code Apache 2.0; data CC BY-SA 4.0 (Robyn Speer et al.) | Zipf values |
| [Open English WordNet 2025](https://github.com/globalwordnet/english-wordnet) | Lemmas (validity gate), senses, glosses, examples, synonyms, antonyms, hypernyms/hyponyms/similar, usage and topic domains | CC BY 4.0, derived from Princeton WordNet (WordNet License) | Senses and relations |
| [Wiktionary](https://en.wiktionary.org) label categories, snapshot `scripts/vocabulary-sources/wiktionary-labels.json` | Membership of *English poetic/literary/formal/archaic terms*, *vulgarities*, *swear words*, *offensive/derogatory terms*, *ethnic slurs* | CC BY-SA 4.0, Wiktionary contributors | Derived style/sensitivity bits |

At runtime the app still uses the online sources it already had, each with attribution where shown: dictionaryapi.dev and
Wiktionary for definitions and examples, Datamuse for category candidates and related words, Wikimedia Commons for
pronunciation audio.

## Required citations

- CEFR-J: *The CEFR-J Wordlist Version 1.5.* Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html. Provided via Open Language Profiles.
- Octanove: *Octanove Vocabulary Profile C1/C2 (ver 1.0)*, Octanove Labs, CC BY-SA 4.0.
- wordfreq: Robyn Speer. *rspeer/wordfreq: v3.0* (2022). Zenodo. https://doi.org/10.5281/zenodo.7199437
- Open English WordNet: McCrae et al., *English WordNet 2025*, CC BY 4.0. Princeton University, *About WordNet*, 2010.
- Wiktionary: label categories from en.wiktionary.org, CC BY-SA 4.0.

## How the data is transformed

1. **Valid words.** Only single, lowercase WordNet lemmas (letters and inner hyphens) are candidates. This drops proper nouns, phrases, numbers and most inflected forms. The build then rejects:
   - abbreviations and fragments;
   - wordfreq's 50 most common words;
   - WordNet "trade name", "plural" and "combining form" entries;
   - British, Australian and Canadian spellings that share a synset with another spelling;
   - words with no usage evidence at all: unknown to wordfreq, the CEFR lists and the style labels.
2. **CEFR, by precedence.** Sources are tried in order: CEFR-J, then Octanove, then Words-CEFR. The first one that lists a word wins, and later sources never overwrite it. Words-CEFR's levels are computed estimates: its 6.0 is the default it gives unrated words and is ignored, and the rest round half-up. The app shows an estimate as "≈B2", never as an official rating. A word listed under several parts of speech keeps its easiest level. 335 words where a profile and Words-CEFR differ by two or more levels are counted, and the profile is kept. A Words-CEFR estimate of B1 or easier on a word that is rare in wordfreq (zipf < 2) is discarded as self-contradictory (it leans on the stem: "spendable" ≈A1 from "spend"), so the word counts as unrated. Profile levels are never second-guessed.
3. **Frequency.** The wordfreq zipf value is stored as is: log10 of occurrences per billion words, where 3 means once per million. The app derives rarity from it: ≥4 very common, ≥3 common, ≥2 uncommon, ≥1.5 rare, below that very rare. A word wordfreq doesn't know (zipf 0) is very rare. These steps were picked after inspecting the kept words' distribution (deciles 1.36 … 4.20) and split it roughly 13 / 27 / 30 / 15 / 15 %.
4. **Difficulty tier**, derived in the app. CEFR A1–A2 is Easy, B1–B2 Medium, C1 Hard, C2 Advanced. Words without CEFR evidence get a tier by rarity: uncommon is **C2+**, rare is **Rare**, very rare is **Very rare**. C2+ is this app's tier, not an official CEFR level, and CEFR ends at C2. The few common words no list rates sit in Medium or Hard for filtering only, and are shown without a level.
5. **Style.** Kept separate from difficulty:
   - **Literary, poetic, formal and archaic** come from the Wiktionary label categories, plus WordNet "archaism" and "formality" usage. The categories are per entry, not per sense, so literary and poetic labels on A1–B2 words are ignored as minor senses.
   - **Technical** comes from WordNet topic domains (law, sciences, medicine, computing, grammar…) on the first sense, and from species, substance and body-part senses of unrated uncommon words. It also covers book-skewed jargon: words whose Google Books frequency exceeds their wordfreq frequency by more than the 95th percentile (0.9 zipf). That list is dominated by legal and government-report language ("hereinbefore", "mortgagor").
   - Words with no label count as Everyday.
6. **Sensitivity.**
   - Vulgar comes from Wiktionary vulgarities and swear words, and WordNet "obscenity".
   - Insult comes from Wiktionary offensive, derogatory and ethnic-slur terms, and WordNet "derogation" and "slur".
   - Sexual comes from WordNet's "sex" topic.
   - Flagged words join the matching sensitive category, so they only appear when that category is enabled.
7. **Categories.** Each emotion category's seeds (`data/category-seeds.json`, shared with the runtime Datamuse queries) are expanded one hop through WordNet: same synset, similar, see-also, attribute, hyponyms and derived forms. Everything else goes to **General**.
8. **Senses.** Up to 5 WordNet senses per word are stored, in WordNet order, each kept separate. A WordNet example is kept only if it actually contains the word.

## Rebuilding

```sh
python3 -m venv .venv-vocab && .venv-vocab/bin/pip install wordfreq==3.1.1
.venv-vocab/bin/python scripts/build-vocabulary-dataset.py                       # pinned, checksummed inputs → identical output
.venv-vocab/bin/python scripts/build-vocabulary-dataset.py --refresh-wiktionary  # re-snapshot the Wiktionary labels first
.venv-vocab/bin/python -m unittest scripts/test_build_vocabulary_dataset.py
```

Downloads are cached in `.cache/vocabulary-sources/` (gitignored) and verified against pinned SHA-256 checksums.
Refreshing the Wiktionary snapshot is the only step that changes inputs; commit the new snapshot with the rebuilt data.
