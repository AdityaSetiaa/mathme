"""Unit tests for the pure transforms in build-vocabulary-dataset.py.  Run: python3 -m unittest scripts/test_build_vocabulary_dataset.py"""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("build", Path(__file__).parent / "build-vocabulary-dataset.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

# A tiny WordNet: synsets keyed by id, lemmas → senses (as load_wordnet returns them).
SYNSETS = {
    "s-sad": {"pos": "a", "lexfile": "adj.all", "definition": "experiencing sorrow", "examples": ["she felt sad", "a gloomy day"],
              "members": ["sad"], "rels": [("similar", "s-doleful")]},
    "s-doleful": {"pos": "s", "lexfile": "adj.all", "definition": "filled with grief", "examples": [], "members": ["doleful", "mournful"], "rels": []},
    "s-colour": {"pos": "n", "lexfile": "noun.attribute", "definition": "a visual attribute", "examples": [], "members": ["color", "colour"], "rels": []},
    "s-tort": {"pos": "n", "lexfile": "noun.act", "definition": "a wrongful act", "examples": [], "members": ["tort"], "rels": [("domain_topic", "s-law")]},
    "s-law": {"pos": "n", "lexfile": "noun.cognition", "definition": "the law", "examples": [], "members": ["jurisprudence"], "rels": []},
    "s-ere": {"pos": "r", "lexfile": "adv.all", "definition": "before", "examples": [], "members": ["ere"], "rels": [("exemplifies", "s-archaism")]},
    "s-archaism": {"pos": "n", "lexfile": "noun.communication", "definition": "an archaic word", "examples": [], "members": ["archaism"], "rels": []},
}
LEMMAS = {
    "sad": [{"pos": "a", "synset": "s-sad", "rels": [("derivation", "sadness"), ("antonym", "glad")]}],
    "colour": [{"pos": "n", "synset": "s-colour", "rels": [("exemplifies", "British spelling")]}],
    "tort": [{"pos": "n", "synset": "s-tort", "rels": []}],
    "ere": [{"pos": "r", "synset": "s-ere", "rels": []}],
}


class Transforms(unittest.TestCase):
    def test_profiles_split_variants_and_keep_the_easiest_level(self):
        rows = [{"headword": "harbor/harbour", "CEFR": "B2"}, {"headword": "abandon", "CEFR": "B1"},
                {"headword": "abandon", "CEFR": "C1"}, {"headword": "according to", "CEFR": "A2"}, {"headword": "x", "CEFR": "Z9"}]
        self.assertEqual(build.profile_levels(rows), {"harbor": "B2", "harbour": "B2", "abandon": "B1"})

    def test_words_cefr_ignores_its_default_level_and_rounds_half_up(self):
        words = [{"word_id": "1", "word": "luminous"}, {"word_id": "2", "word": "threnody"}, {"word_id": "3", "word": "ethereal"}]
        pos = [{"word_id": "1", "level": "5.5"}, {"word_id": "2", "level": "6"}, {"word_id": "3", "level": "3.49"}, {"word_id": "3", "level": ""}]
        self.assertEqual(build.words_cefr_levels(words, pos), {"luminous": "C2", "ethereal": "B1"})  # 6.0 = "unrated"

    def test_cefr_precedence_never_lets_a_later_source_overwrite(self):
        cefrj, octanove, wcd = {"abandon": "B1"}, {"abandon": "C1", "timid": "C1"}, {"abandon": "A1", "timid": "A2", "ethereal": "B2"}
        self.assertEqual(build.resolve_cefr("abandon", cefrj, octanove, wcd, 4.0), ("B1", "cefrj"))
        self.assertEqual(build.resolve_cefr("timid", cefrj, octanove, wcd, 3.0), ("C1", "octanove"))
        self.assertEqual(build.resolve_cefr("ethereal", cefrj, octanove, wcd, 3.2), ("B2", "words-cefr"))
        self.assertEqual(build.resolve_cefr("threnody", cefrj, octanove, wcd, 1.5), (None, ""))
        # an "easy" estimate on a rare word contradicts itself and is dropped; profiles are never second-guessed
        self.assertEqual(build.resolve_cefr("spendable", {}, {}, {"spendable": "A1"}, 1.4), (None, ""))
        self.assertEqual(build.resolve_cefr("abandon", {"abandon": "A1"}, {}, {}, 1.0), ("A1", "cefrj"))

    def test_invalid_words_are_rejected_with_a_reason(self):
        r = lambda w, usages=frozenset(), zipf=2.0, cefr=None, styles=frozenset(), senses=None: build.reject_reason(
            w, senses or LEMMAS.get(w, LEMMAS["sad"]), SYNSETS, set(usages), zipf, cefr, set(styles), {"the"})
        self.assertEqual(r("mph"), "abbreviation-or-fragment")
        self.assertEqual(r("the"), "grammar-word")
        self.assertEqual(r("xerox", {"trade name"}), "brand-or-inflection")
        self.assertEqual(r("colour", {"British spelling"}), "spelling-variant")  # "color" is in the same synset
        self.assertEqual(r("zorbic", zipf=0), "no-usage-evidence")
        self.assertIsNone(r("susurrus", zipf=0, styles={"literary"}))  # unknown to wordfreq but labelled: kept
        self.assertIsNone(r("sad", cefr="A1"))

    def test_style_labels_and_the_everyday_rule(self):
        labels = {"English poetic terms": {"sad", "ere"}, "English literary terms": {"tort"}}
        usages = lambda w: build.usage_labels(LEMMAS[w], SYNSETS)
        # A poetic label on an everyday (A1–B2) word marks a minor sense and is ignored.
        self.assertEqual(build.styles_for("sad", LEMMAS["sad"], SYNSETS, usages("sad"), labels, "A1", 5.0), set())
        self.assertEqual(build.styles_for("ere", LEMMAS["ere"], SYNSETS, usages("ere"), labels, None, 2.0), {"poetic", "archaic"})
        self.assertEqual(build.styles_for("tort", LEMMAS["tort"], SYNSETS, usages("tort"), labels, None, 2.5), {"literary", "technical"})

    def test_book_skew_measures_books_against_general_use(self):
        skew = build.book_skew({"hereinbefore": 1000, "okay": 10}, {"hereinbefore": 1.0, "okay": 5.0, "absent": 2.0})
        self.assertGreater(skew["hereinbefore"], skew["okay"])
        self.assertNotIn("absent", skew)
        self.assertEqual(build.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10)

    def test_wordnet_enrichment_keeps_senses_apart_and_examples_honest(self):
        senses = build.senses_for("sad", LEMMAS["sad"], SYNSETS)
        self.assertEqual(senses, [["a", "experiencing sorrow", ["she felt sad"], [], ["glad"], ["doleful"]]])  # "a gloomy day" doesn't use the word
        self.assertEqual(build.expand_seeds(["sad"], LEMMAS, SYNSETS), {"sad", "doleful", "mournful", "sadness"})

    def test_bits(self):
        self.assertEqual(build.bits({"literary", "technical"}, build.STYLE_BITS), 17)


if __name__ == "__main__":
    unittest.main()
