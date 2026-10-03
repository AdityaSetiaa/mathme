#!/usr/bin/env python3
"""Builds the vocabulary lexicon from free/open datasets. Sources, licenses and transformations: DATA_SOURCES.md.

    python3 -m venv .venv-vocab && .venv-vocab/bin/pip install wordfreq==3.1.1
    .venv-vocab/bin/python scripts/build-vocabulary-dataset.py                       # build from pinned inputs
    .venv-vocab/bin/python scripts/build-vocabulary-dataset.py --refresh-wiktionary  # re-snapshot Wiktionary labels first

Deterministic: every input is pinned (downloads are checksummed, the Wiktionary snapshot is committed), output is
sorted, and nothing time-dependent is written. Generated files must not be edited by hand.

The output holds raw facts only (CEFR level + source, wordfreq zipf, usage labels, sensitivity flags, categories,
WordNet senses). Rarity and difficulty tiers are derived from those at runtime (src/features/vocabulary/catalog.ts),
so thresholds can change without rebuilding.
"""
import csv
import gzip
import hashlib
import importlib.metadata
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "vocabulary-sources"
SNAPSHOT = ROOT / "scripts" / "vocabulary-sources" / "wiktionary-labels.json"
DATA = ROOT / "src" / "features" / "vocabulary" / "data"
SEEDS = DATA / "category-seeds.json"

OLP = "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/d4e45b75b38f27b30dfc5c44d8c571aec7e7092f"
WCD = "https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/c05858cf109efbc81775d86908a873ca54fa85ff"
SOURCES = {
    "cefrj.csv": (f"{OLP}/cefrj-vocabulary-profile-1.5.csv", "b0dd3c635f1c9a4fdf1490c7e5b7c48e8bbe55b652ad0c9860a95f98e10ae498"),
    "octanove.csv": (f"{OLP}/octanove-vocabulary-profile-c1c2-1.0.csv", "18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380"),
    "wcd-words.csv": (f"{WCD}/csv/words.csv", "8cc25f3517bbd4b2649a58ceba8376c202cea16a4e2987cb1251f4ddacfcea65"),
    "wcd-word-pos.csv": (f"{WCD}/csv/word_pos.csv", "25061548ece58a33daa745a93836be5db8ea5173a768d02d4e3e71d9c1ca161c"),
    "wcd-books-frequency.csv": (
        f"{WCD}/datasets/valid_words_sorted_by_frequency.csv",  # Google Books 1-gram counts, 1900–2019
        "14cf10c377b2158889d1ddd60964a623cf8a20fd5bfc4f6b2c31617e374b3733",
    ),
    "oewn-2025.xml.gz": (
        "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz",
        "9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe",
    ),
}
WORDFREQ_VERSION = "3.1.1"

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
CEFR_SOURCES = ["", "cefrj", "octanove", "words-cefr"]  # index 0 = no CEFR evidence
STYLE_BITS = {"literary": 1, "poetic": 2, "formal": 4, "archaic": 8, "technical": 16}
FLAG_BITS = {"vulgar": 1, "insult": 2, "sexual": 4}
WORD = re.compile(r"[a-z]+(?:-[a-z]+)*")

# Wiktionary label categories (one per entry, any sense). Category names as used on en.wiktionary.org.
STYLE_LABELS = {
    "literary": ["English literary terms"],
    "poetic": ["English poetic terms"],
    "formal": ["English formal terms"],
    "archaic": ["English archaic terms"],
}
SENSITIVE_LABELS = {
    "vulgar": ["English vulgarities", "English swear words"],
    "insult": ["English offensive terms", "English derogatory terms", "English ethnic slurs"],
}
# WordNet usage domains ("exemplifies") and topic domains, matched by the target's lemma.
USAGE_STYLE = {"archaism": "archaic", "archaicism": "archaic", "formality": "formal"}
USAGE_FLAG = {"obscenity": "vulgar", "dirty word": "vulgar", "derogation": "insult", "ethnic slur": "insult", "slur": "insult"}
USAGE_REJECT = {"trade name", "trademark", "brand name", "protonym", "plural", "plural form", "combining form", "acronym", "initialism"}
SPELLING_VARIANT = {"British spelling", "Australian spelling", "Canadian spelling"}
TECHNICAL_TOPICS = {
    "jurisprudence", "law", "computer science", "chemical science", "chemistry", "biological science", "biology",
    "natural philosophy", "physics", "math", "mathematics", "botany", "statistics", "medical specialty", "medicine",
    "medical science", "linguistics", "genetic science", "genetics", "anatomy", "psychological science", "psychology",
    "geology", "astronomy", "zoological science", "zoology", "physiology", "logic", "grammar", "electronics",
    "engineering", "economics", "finance", "pathology", "pharmacology", "biochemistry", "computing",
}
# Species, substances and body parts: only technical when the word is outside the CEFR lists and not common.
TECHNICAL_LEXFILES = {"noun.plant", "noun.animal", "noun.substance", "noun.body"}
MAX_SENSES, MAX_LIST = 5, 6


# ---------- inputs ----------

def fetch(name):
    url, sha = SOURCES[name]
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {url}", file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != sha:
        sys.exit(f"{name}: checksum {digest} != pinned {sha}; delete {path} or update the pin deliberately")
    return path


def refresh_wiktionary():
    """Snapshots the label categories through the MediaWiki API (a handful of paginated requests)."""
    out = {}
    for cat in sorted({c for cats in [*STYLE_LABELS.values(), *SENSITIVE_LABELS.values()] for c in cats}):
        titles, cont = [], {}
        while True:
            q = {"action": "query", "format": "json", "list": "categorymembers", "cmtitle": f"Category:{cat}",
                 "cmnamespace": "0", "cmlimit": "500", **cont}
            req = urllib.request.Request("https://en.wiktionary.org/w/api.php?" + urllib.parse.urlencode(q),
                                         headers={"User-Agent": "mathme-vocabulary-build/1.0 (open-data lexicon build)"})
            for attempt in range(8):
                try:
                    data = json.load(urllib.request.urlopen(req))
                    break
                except urllib.error.HTTPError as err:  # 429: Wikimedia asks to slow down
                    if err.code != 429 or attempt == 7:
                        raise
                    time.sleep(int(err.headers.get("Retry-After") or 30) * (attempt + 1))
            titles += [m["title"] for m in data["query"]["categorymembers"]]
            if "continue" not in data:
                break
            cont = {"cmcontinue": data["continue"]["cmcontinue"]}
            time.sleep(0.5)
        out[cat] = sorted(set(titles))
        print(f"{cat}: {len(out[cat])}", file=sys.stderr)
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(json.dumps({"retrieved": time.strftime("%Y-%m-%d"), "categories": out}, indent=0, ensure_ascii=False) + "\n")


# ---------- pure transforms (unit-tested in scripts/test_build_vocabulary_dataset.py) ----------

def profile_levels(rows):
    """CEFR-J / Octanove rows → {word: level}. Headwords list spelling variants ("harbor/harbour"); each variant
    counts. A word listed under several parts of speech keeps its easiest level: that's when a learner meets it."""
    out = {}
    for row in rows:
        level = row.get("CEFR")
        if level not in LEVELS:
            continue
        for variant in row["headword"].split("/"):
            w = variant.strip().lower()
            if WORD.fullmatch(w):
                out[w] = min(out.get(w, level), level, key=LEVELS.index)
    return out


def words_cefr_levels(word_rows, pos_rows):
    """Words-CEFR-Dataset → {word: level}. Its levels are computed floats 1–6, and exactly 6.0 is the default it gives
    every word it couldn't rate, so 6.0 carries no information and is ignored. Others round half-up to a level."""
    words = {r["word_id"]: r["word"] for r in word_rows}
    out = {}
    for r in pos_rows:
        if not r["level"]:
            continue
        lvl = float(r["level"])
        w = words.get(r["word_id"], "")
        if lvl >= 6.0 or not WORD.fullmatch(w):
            continue
        level = LEVELS[min(5, max(0, math.floor(lvl + 0.5) - 1))]
        out[w] = min(out.get(w, level), level, key=LEVELS.index)
    return out


def resolve_cefr(w, cefrj, octanove, wcd, zipf):
    """Precedence: CEFR-J, then Octanove C1/C2, then Words-CEFR-Dataset (an estimate), else no evidence.
    The first source that lists the word wins; later sources never overwrite it. A Words-CEFR estimate of B1 or
    easier on a word that's rare in wordfreq (zipf < 2) is discarded as contradictory: the estimate leans on the
    word's stem ("spendable" ≈A1 from "spend"), so the word is treated as unrated rather than easy."""
    for source, table in (("cefrj", cefrj), ("octanove", octanove), ("words-cefr", wcd)):
        if w in table:
            if source == "words-cefr" and LEVELS.index(table[w]) <= LEVELS.index("B1") and zipf < 2:
                return None, ""
            return table[w], source
    return None, ""


def load_wordnet(path):
    """Open English WordNet (WN-LMF XML) → (lemma → [sense], synset id → synset). Senses keep WordNet's order
    within a part of speech (most frequent first)."""
    entry_lemma, lemmas = {}, defaultdict(list)
    sense_lemma, synsets = {}, {}
    dc_subject = "{https://globalwordnet.github.io/schemas/dc/}subject"
    for _, el in ET.iterparse(gzip.open(path)):
        if el.tag == "LexicalEntry":
            lemma = el.find("Lemma")
            w = lemma.get("writtenForm")
            entry_lemma[el.get("id")] = w
            for s in el.findall("Sense"):
                sense_lemma[s.get("id")] = w
                lemmas[w].append({"pos": lemma.get("partOfSpeech"), "synset": s.get("synset"),
                                  "rels": [(r.get("relType"), r.get("target")) for r in s.findall("SenseRelation")]})
            el.clear()
        elif el.tag == "Synset":
            d = el.find("Definition")
            synsets[el.get("id")] = {
                "pos": el.get("partOfSpeech"),
                "lexfile": el.get(dc_subject) or "",
                "definition": (d.text or "").strip() if d is not None else "",
                "examples": [(e.text or "").strip().strip('"') for e in el.findall("Example")],
                "members": [entry_lemma.get(m, "") for m in (el.get("members") or "").split()],
                "rels": [(r.get("relType"), r.get("target")) for r in el.findall("SynsetRelation")],
            }
            el.clear()
    # resolve sense-relation targets (sense ids) to lemmas
    for senses in lemmas.values():
        for s in senses:
            s["rels"] = [(t, sense_lemma.get(target, "")) for t, target in s["rels"]]
    return dict(lemmas), synsets


def synset_name(synsets, sid):
    s = synsets.get(sid)
    return s["members"][0] if s and s["members"] else ""


def usage_labels(senses, synsets):
    """Every WordNet usage label ("archaism", "trade name"…) on any sense of the word, sense- or synset-level."""
    out = set()
    for s in senses:
        out |= {target for t, target in s["rels"] if t == "exemplifies"}
        out |= {synset_name(synsets, target) for t, target in synsets[s["synset"]]["rels"] if t == "exemplifies"}
    return out


def reject_reason(w, senses, synsets, usages, zipf, cefr, styles, grammar):
    """Why a WordNet lemma isn't vocabulary, or None. Proper nouns, phrases and numbers never get here (WORD gate)."""
    if len(w) < 3 or not re.search(r"[aeiouy]", w):
        return "abbreviation-or-fragment"
    if w in grammar:
        return "grammar-word"
    if usages & USAGE_REJECT:
        return "brand-or-inflection"
    if usages & SPELLING_VARIANT and any(m != w and WORD.fullmatch(m) for s in senses for m in synsets[s["synset"]]["members"]):
        return "spelling-variant"  # "colour" next to "color" in the same synset: keep one form
    if zipf == 0 and not cefr and not (styles & {"literary", "poetic", "formal", "archaic"}):
        return "no-usage-evidence"  # unknown to wordfreq, the CEFR lists and the style labels: corpus artifact or jargon
    return None


def styles_for(w, senses, synsets, usages, labels, cefr, zipf):
    """Register/style labels. Wiktionary labels are per entry, not per sense, so on everyday words (CEFR A1–B2)
    a literary/poetic label almost always marks a minor sense and is ignored."""
    styles = set()
    everyday = cefr in ("A1", "A2", "B1", "B2")
    for style, cats in STYLE_LABELS.items():
        if any(w in labels.get(c, ()) for c in cats) and not (everyday and style in ("literary", "poetic")):
            styles.add(style)
    styles |= {USAGE_STYLE[u] for u in usages if u in USAGE_STYLE}
    first = synsets[senses[0]["synset"]]
    topics = {synset_name(synsets, target) for t, target in first["rels"] if t == "domain_topic"}
    if topics & TECHNICAL_TOPICS or (not cefr and zipf < 3 and first["lexfile"] in TECHNICAL_LEXFILES):
        styles.add("technical")
    return styles


def flags_for(w, senses, synsets, usages, labels):
    flags = {USAGE_FLAG[u] for u in usages if u in USAGE_FLAG}
    for flag, cats in SENSITIVE_LABELS.items():
        if any(w in labels.get(c, ()) for c in cats):
            flags.add(flag)
    for s in senses:
        if "sex" in {synset_name(synsets, target) for t, target in synsets[s["synset"]]["rels"] if t == "domain_topic"}:
            flags.add("sexual")
    return flags


def book_skew(book_counts, zipfs):
    """How much more frequent a word is in Google Books than in wordfreq's general mix (subtitles, web, news,
    Wikipedia…), in zipf units. High skew is not a literary signal: the top of the list is legal, government-report
    and laboratory jargon (hereinbefore, mortgagor, filtrate). It is used only to flag that jargon as technical."""
    total = sum(book_counts.values())
    return {w: math.log10(book_counts[w] / total * 1e9) - z for w, z in zipfs.items() if z > 0 and book_counts.get(w)}


def percentile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * p))]


def expand_seeds(seeds, lemmas, synsets):
    """Category membership from WordNet, one hop from each seed's first three senses: same synset, similar
    (adjective clusters), see-also, attribute, hyponyms, and derivationally related forms of the seed itself."""
    found = set()
    for seed in seeds:
        for s in lemmas.get(seed, [])[:3]:
            syn = synsets[s["synset"]]
            ids = [s["synset"]] + [t for r, t in syn["rels"] if r in ("similar", "also", "attribute", "hyponym")]
            for sid in ids:
                found |= set(synsets.get(sid, {}).get("members", []))
            found |= {target for r, target in s["rels"] if r in ("derivation", "also")}
    return {w for w in found if WORD.fullmatch(w)}


def example_for(w, examples):
    """WordNet examples belong to the whole synset; keep only ones that actually use this word."""
    stem = w[: max(4, len(w) - 2)]
    return [e for e in examples if re.search(rf"\b{re.escape(stem)}", e.lower())][:2]


def senses_for(w, senses, synsets):
    out = []
    for s in senses[:MAX_SENSES]:
        syn = synsets[s["synset"]]
        if not syn["definition"]:
            continue
        synonyms = [m for m in syn["members"] if m != w and m and len(m.split()) <= 3][:MAX_LIST]
        antonyms = [t for r, t in s["rels"] if r == "antonym" and t][:MAX_LIST]
        related = []
        for r, t in syn["rels"]:
            if r in ("hypernym", "similar", "hyponym", "also"):
                name = synset_name(synsets, t)
                if name and name != w and name not in related and name not in synonyms:
                    related.append(name)
        out.append([syn["pos"], syn["definition"], example_for(w, syn["examples"]), synonyms, antonyms, related[:MAX_LIST]])
    return out


def bits(names, table):
    return sum(table[n] for n in names)


# ---------- build ----------

def build():
    import wordfreq  # build-time only

    if importlib.metadata.version("wordfreq") != WORDFREQ_VERSION:
        sys.exit(f"wordfreq {WORDFREQ_VERSION} required for a reproducible build")
    read_csv = lambda p: list(csv.DictReader(io.open(p, encoding="utf-8-sig")))
    cefrj = profile_levels(read_csv(fetch("cefrj.csv")))
    octanove = profile_levels(read_csv(fetch("octanove.csv")))
    wcd = words_cefr_levels(read_csv(fetch("wcd-words.csv")), read_csv(fetch("wcd-word-pos.csv")))
    lemmas, synsets = load_wordnet(fetch("oewn-2025.xml.gz"))
    labels = {k: set(v) for k, v in json.loads(SNAPSHOT.read_text())["categories"].items()}
    seeds = json.loads(SEEDS.read_text())
    categories = list(seeds)  # bit order, mirrored in the output's meta
    members = {c: expand_seeds(seeds[c], lemmas, synsets) for c in categories}
    grammar = set(wordfreq.top_n_list("en", 50))
    candidates = sorted(w for w in lemmas if WORD.fullmatch(w))
    zipfs = {w: round(wordfreq.zipf_frequency(w, "en", wordlist="large"), 2) for w in candidates}
    books = {r["Word"]: int(r["Frequency count"]) for r in read_csv(fetch("wcd-books-frequency.csv"))}
    skew = book_skew(books, zipfs)
    jargon_skew = round(percentile(skew.values(), 0.95), 2)  # data-derived: the most book-skewed 5%

    stats, rejected = Counter(), Counter()
    rows, senses_out, disagreements = [], defaultdict(dict), 0
    rejected["not-a-single-lowercase-word"] = len(lemmas) - len(candidates)
    for w in candidates:
        senses = sorted(lemmas[w], key=lambda s: -sum(x["pos"] == s["pos"] for x in lemmas[w]))  # dominant POS first
        usages = usage_labels(senses, synsets)
        zipf = zipfs[w]
        cefr, source = resolve_cefr(w, cefrj, octanove, wcd, zipf)
        if not source and w in wcd:
            stats["words-cefr-estimate-discarded(easy but rare)"] += 1
        if source in ("cefrj", "octanove") and w in wcd and abs(LEVELS.index(wcd[w]) - LEVELS.index(cefr)) >= 2:
            disagreements += 1  # kept: the profile wins by precedence; counted for the report
        styles = styles_for(w, senses, synsets, usages, labels, cefr, zipf)
        if source not in ("cefrj", "octanove") and not styles & {"literary", "poetic"} and skew.get(w, 0) >= jargon_skew:
            styles.add("technical")
            stats["technical-by-book-skew"] += 1
        reason = reject_reason(w, senses, synsets, usages, zipf, cefr, styles, grammar)
        if reason:
            rejected[reason] += 1
            continue
        sense_rows = senses_for(w, senses, synsets)
        if not sense_rows:
            rejected["no-definition"] += 1
            continue
        flags = flags_for(w, senses, synsets, usages, labels)
        cats = {c for c in categories if w in members[c]}
        cats |= {f for f in flags if f in categories}  # sensitive words are gated by their sensitive category
        if not cats:
            cats = {"general"}
        pos = "".join(sorted({s["pos"] for s in senses}))
        rows.append("\t".join([w, cefr or "", source, f"{zipf:g}", str(bits(styles, STYLE_BITS)),
                               str(bits(flags, FLAG_BITS)), str(sum(1 << categories.index(c) for c in cats)), pos]))
        senses_out[w[0]][w] = sense_rows
        stats["kept"] += 1
        stats[f"cefr:{cefr or 'none'}"] += 1
        stats[f"source:{source or 'none'}"] += 1
        for s in styles:
            stats[f"style:{s}"] += 1
        for f in flags:
            stats[f"flag:{f}"] += 1
        for c in cats:
            stats[f"category:{c}"] += 1

    DATA.mkdir(parents=True, exist_ok=True)
    meta = {
        "note": "Generated by scripts/build-vocabulary-dataset.py from free/open data; see DATA_SOURCES.md. Do not edit.",
        "columns": ["word", "cefr", "cefrSource", "zipf", "styleBits", "flagBits", "categoryBits", "wordnetPos"],
        "styleBits": STYLE_BITS, "flagBits": FLAG_BITS, "categories": categories,
        "wiktionarySnapshot": json.loads(SNAPSHOT.read_text())["retrieved"], "wordfreq": WORDFREQ_VERSION,
        "jargonBookSkew": jargon_skew,
    }
    # One string per file so TypeScript types each import as { meta, rows: string } instead of a 40k-key object.
    write_json(DATA / "lexicon.json", {"meta": meta, "rows": "\n".join(rows)})
    shard_dir = DATA / "senses"
    shard_dir.mkdir(exist_ok=True)
    for letter in sorted(senses_out):
        write_json(shard_dir / f"{letter}.json", {"data": json.dumps(senses_out[letter], ensure_ascii=False, separators=(",", ":"), sort_keys=True)})
    loader = ["// Generated by scripts/build-vocabulary-dataset.py. Do not edit.",
              "// One lazily imported file per first letter, so a lookup never loads every word's senses.",
              "export const SENSE_SHARDS: Record<string, () => Promise<{ default: { data: string } }>> = {"]
    loader += [f'  {l}: () => import("./senses/{l}.json"),' for l in sorted(senses_out)]
    (DATA / "senses.ts").write_text("\n".join(loader + ["};", ""]))

    stats.update({f"rejected:{k}": v for k, v in rejected.items()})
    stats["cefr-disagreements(profile vs words-cefr, >=2 levels)"] = disagreements
    stats["jargon-book-skew-threshold(p95)"] = jargon_skew
    zipfs = sorted(float(r.split("\t")[3]) for r in rows if float(r.split("\t")[3]) > 0)
    stats["zipf-quantiles(10..90)"] = [zipfs[len(zipfs) * q // 10] for q in range(1, 10)]
    write_json(DATA / "lexicon-stats.json", dict(sorted(stats.items())), pretty=True)
    print(json.dumps(dict(sorted(stats.items())), indent=1))


def write_json(path, obj, pretty=False):
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=1 if pretty else None, separators=None if pretty else (",", ":"))
    path.write_text(text + "\n", encoding="utf-8")


if __name__ == "__main__":
    if "--refresh-wiktionary" in sys.argv:
        refresh_wiktionary()
    build()
