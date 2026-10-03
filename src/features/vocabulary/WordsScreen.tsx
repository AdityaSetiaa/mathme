"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Screen } from "@/components/layout/Screen";
import { getNextWord, getSettings, setWordFlag } from "./actions";
import { CATEGORY_INFO, DISCOVERY_CATEGORIES, type CollectedWord, type DiscoveryCategory, type DiscoveryMode } from "./catalog";
import { Chip, ChipRow, FavoriteButton, readCache, WordHeading, writeCache } from "./parts";

type Problem = "exhausted" | "no-categories" | "no-levels" | "no-styles" | "error" | "offline";

export function WordsScreen() {
  const [enabled, setEnabled] = useState<DiscoveryCategory[]>([]);
  const [mode, setMode] = useState<DiscoveryMode>("random");
  const [word, setWord] = useState<CollectedWord | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    // Offline this fails and only Random is offered; discovering then explains why.
    getSettings()
      .then((s) => setEnabled(s.enabled))
      .catch(() => {});
  }, []);

  async function discover() {
    if (loading) return;
    setLoading(true);
    setSaveFailed(false);
    try {
      const res = await getNextWord(mode);
      if (res.status === "ok") {
        setWord(res.word);
        setProblem(null);
        writeCache([res.word, ...readCache()]);
      } else setProblem(res.status);
    } catch {
      setProblem(navigator.onLine ? "error" : "offline");
    } finally {
      setLoading(false);
    }
  }

  async function toggleFavorite(w: CollectedWord) {
    const set = (isFavorite: boolean) => setWord((cur) => (cur?.id === w.id ? { ...cur, isFavorite } : cur));
    set(!w.isFavorite);
    setSaveFailed(false);
    try {
      await setWordFlag(w.id, "isFavorite", !w.isFavorite);
    } catch {
      set(w.isFavorite);
      setSaveFailed(true);
    }
  }

  const modes: DiscoveryMode[] = ["random", ...DISCOVERY_CATEGORIES.filter((c) => enabled.includes(c))];

  return (
    <Screen
      title="Words"
      action={
        <>
          <Link href="/words/collection" className="flex h-10 items-center rounded-full border border-line bg-card px-4 text-sm font-semibold active:bg-line">
            Your Words
          </Link>
          <Link href="/words/settings" aria-label="Vocabulary settings" className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-muted active:bg-line">
            ⚙
          </Link>
        </>
      }
    >
      <ChipRow>
        {modes.map((m) => (
          <Chip
            key={m}
            on={mode === m}
            onClick={() => {
              setMode(m);
              setProblem(null);
            }}
          >
            {m === "random" ? "Random" : CATEGORY_INFO[m].label}
          </Chip>
        ))}
      </ChipRow>

      <div aria-live="polite" className={`flex flex-1 flex-col items-center justify-center py-10 transition-opacity duration-200 ${loading ? "opacity-30" : ""}`}>
        {problem ? (
          <Message problem={problem} random={mode === "random"} />
        ) : word ? (
          <article key={word.id} className="animate-reveal flex w-full flex-col items-center text-center">
            <WordHeading word={word} />
            <p className="mt-8 max-w-md text-pretty text-lg leading-relaxed">{word.definition}</p>
            {word.example && <p className="mt-4 max-w-md text-pretty italic leading-relaxed text-muted">“{word.example}”</p>}
            <div className="mt-8">
              <FavoriteButton on={word.isFavorite} onToggle={() => toggleFavorite(word)} />
            </div>
            {saveFailed && <p className="mt-2 text-sm text-bad">Couldn’t save. Check your connection.</p>}
          </article>
        ) : (
          <div className="animate-reveal text-center">
            <p className="text-2xl font-semibold">What word will you get?</p>
            <p className="mt-2 text-muted">Tap New Word to discover one.</p>
          </div>
        )}
      </div>

      <button
        onClick={discover}
        disabled={loading}
        className="h-16 shrink-0 rounded-3xl bg-accent text-xl font-bold tracking-wide text-accent-ink active:scale-[0.98] disabled:opacity-70"
      >
        {loading ? "FINDING…" : "NEW WORD"}
      </button>
    </Screen>
  );
}

function Message({ problem, random }: { problem: Problem; random: boolean }) {
  const link = "mt-4 inline-block font-semibold text-accent underline underline-offset-4";
  const [title, body, action] = {
    exhausted: random
      ? ["You’ve discovered every available word for your settings.", "Turn on more categories, levels or styles.", <Link key="s" href="/words/settings" className={link}>Open settings</Link>]
      : ["You’ve discovered all available words in this category.", "Try another category, or allow more levels or styles in settings.", <Link key="s" href="/words/settings" className={link}>Open settings</Link>],
    "no-categories": [
      random ? "Every word category is turned off." : "This category is turned off.",
      "Choose which kinds of words you want in settings.",
      <Link key="s" href="/words/settings" className={link}>Open settings</Link>,
    ],
    "no-styles": [
      "Every word style is turned off.",
      "Choose from Everyday to Poetic in settings.",
      <Link key="s" href="/words/settings" className={link}>Open settings</Link>,
    ],
    "no-levels": [
      "Every word level is turned off.",
      "Choose from Easy to Advanced in settings.",
      <Link key="s" href="/words/settings" className={link}>Open settings</Link>,
    ],
    error: ["Couldn’t find a new word right now.", "Try again.", null],
    offline: [
      "You’re offline.",
      "Your saved words are still available, but discovering a new word requires a connection.",
      <Link key="c" href="/words/collection" className={link}>Your Words</Link>,
    ],
  }[problem];
  return (
    <div className="animate-reveal max-w-xs text-center">
      <p className="text-lg font-semibold text-pretty">{title}</p>
      <p className="mt-2 text-pretty text-muted">{body}</p>
      {action}
    </div>
  );
}
