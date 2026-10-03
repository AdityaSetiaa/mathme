"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Screen } from "@/components/layout/Screen";
import { forgetWord, getCollection, markViewed, removeFromCollection, setWordFlag } from "./actions";
import {
  CATEGORY_INFO,
  CEFR_SOURCE_INFO,
  classLine,
  DIFFICULTY_INFO,
  DISCOVERY_CATEGORIES,
  levelLabel,
  perMillion,
  RARITY_INFO,
  STYLE_INFO,
  type CollectedWord,
  type DiscoveryCategory,
} from "./catalog";
import { Chip, ChipRow, ConfirmDialog, Heart, readCache, WordHeading, writeCache } from "./parts";

type Filter = "all" | "favorites" | DiscoveryCategory;
type Data = { words: CollectedWord[]; offline: boolean };

export function CollectionScreen() {
  const id = useSearchParams().get("w");
  const [data, setData] = useState<Data | null>(null);
  // Kept here, not in the list, so they survive a trip to a word's details and back.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    getCollection()
      .then((words) => setData({ words, offline: false }))
      .catch(() => setData({ words: readCache(), offline: true }));
  }, []);
  useEffect(() => {
    if (data && !data.offline) writeCache(data.words);
  }, [data]);

  if (!data) return <Screen title="Your Words" back="/words">{null}</Screen>;

  // An id that isn't in the collection (stale link, or just removed) shows the list.
  const word = id === null ? undefined : data.words.find((w) => w.id === id);
  if (word)
    return (
      <WordDetail
        key={word.id}
        word={word}
        offline={data.offline}
        onChange={(next) => setData((d) => d && { ...d, words: d.words.map((w) => (w.id === next.id ? next : w)) })}
        onGone={() => setData((d) => d && { ...d, words: d.words.filter((w) => w.id !== word.id) })}
      />
    );

  const categories = DISCOVERY_CATEGORIES.filter((c) => data.words.some((w) => w.discoveryCategories.includes(c)));
  const active = filter === "all" || filter === "favorites" || categories.includes(filter) ? filter : "all";
  const q = query.trim().toLowerCase();
  const shown = data.words.filter(
    (w) =>
      (active === "all" || (active === "favorites" ? w.isFavorite : w.discoveryCategories.includes(active))) &&
      (!q || w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q)),
  );
  if (q) shown.sort((a, b) => Number(!a.word.toLowerCase().includes(q)) - Number(!b.word.toLowerCase().includes(q))); // name matches first

  return (
    <Screen title="Your Words" back="/words">
      {data.offline && <p className="mb-4 rounded-2xl border border-line bg-card p-3 text-sm text-muted">You’re offline. Showing the words saved on this device.</p>}
      {!data.words.length ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-lg font-semibold">Your vocabulary is empty.</p>
          <p className="mt-2 max-w-xs text-muted">Discover a few words to start building your collection.</p>
          <Link href="/words" className="mt-6 flex h-12 items-center rounded-2xl bg-accent px-6 font-semibold text-accent-ink">
            Discover a word
          </Link>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your words…"
            aria-label="Search your words"
            className="h-12 shrink-0 rounded-2xl border border-line bg-card px-4 outline-none focus:border-accent"
          />
          <ChipRow className="mt-3">
            {(["all", "favorites", ...categories] as Filter[]).map((f) => (
              <Chip key={f} on={active === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "favorites" ? "Favorites" : CATEGORY_INFO[f].label}
              </Chip>
            ))}
          </ChipRow>
          <p className="mb-2 mt-4 text-sm text-muted">
            {shown.length} {shown.length === 1 ? "word" : "words"}
          </p>
          {shown.length ? (
            <ul className="flex flex-col gap-2">
              {shown.map((w) => (
                <li key={w.id}>
                  <Link href={`/words/collection?w=${encodeURIComponent(w.id)}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 active:bg-line">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {w.word} <span className="text-sm font-normal italic text-muted">{[w.partOfSpeech, ...classLine(w)].filter(Boolean).join(" · ")}</span>
                      </p>
                      <p className="truncate text-sm text-muted">{w.definition}</p>
                    </div>
                    {w.isFavorite && (
                      <span className="text-bad" aria-label="Favorite">
                        <Heart filled />
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-12 text-center text-muted">No words found.</p>
          )}
        </>
      )}
    </Screen>
  );
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmtPerMillion = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n >= 0.1 ? n.toFixed(1) : n.toPrecision(1));

function WordDetail({ word: w, offline, onChange, onGone }: { word: CollectedWord; offline: boolean; onChange: (w: CollectedWord) => void; onGone: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"remove" | "forget" | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!offline) markViewed(w.id).catch(() => {}); // just a timestamp; not worth bothering the user about
  }, [w.id, offline]);

  async function flip(flag: "isFavorite" | "learned") {
    setFailed(false);
    onChange({ ...w, [flag]: !w[flag] });
    try {
      await setWordFlag(w.id, flag, !w[flag]);
    } catch {
      onChange(w);
      setFailed(true);
    }
  }

  async function confirm() {
    const action = confirming === "forget" ? forgetWord : removeFromCollection;
    setConfirming(null);
    try {
      await action(w.id);
      onGone();
      router.replace("/words/collection");
    } catch {
      setFailed(true);
    }
  }

  const pill = "flex h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold transition-transform active:scale-95";

  return (
    <Screen title=" " back="/words/collection">
      <article className="animate-reveal flex flex-col">
        <WordHeading word={w} />
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => flip("isFavorite")} aria-pressed={w.isFavorite} className={`${pill} ${w.isFavorite ? "text-bad" : "text-muted"}`}>
            <span key={String(w.isFavorite)} className={w.isFavorite ? "animate-beat" : ""}>
              <Heart filled={w.isFavorite} />
            </span>
            Favorite
          </button>
          <button onClick={() => flip("learned")} aria-pressed={w.learned} className={`${pill} ${w.learned ? "text-good" : "text-muted"}`}>
            <span aria-hidden>{w.learned ? "✓" : "○"}</span> Learned
          </button>
        </div>
        {failed && <p className="mt-3 text-center text-sm text-bad">Couldn’t save. Check your connection.</p>}

        <div className="mt-10 flex flex-col gap-7">
          <Section label="Meaning">
            <p className="text-pretty text-lg leading-relaxed">{w.definition}</p>
          </Section>
          {w.example && (
            <Section label="Context">
              <p className="text-pretty italic leading-relaxed text-muted">“{w.example}”</p>
            </Section>
          )}
          {w.synonyms.length > 0 && (
            <Section label="Similar words">
              <p>{w.synonyms.join(" · ")}</p>
            </Section>
          )}
          {w.antonyms.length > 0 && (
            <Section label="Opposites">
              <p>{w.antonyms.join(" · ")}</p>
            </Section>
          )}
          {w.relatedWords && (
            <Section label="Related">
              <p>{w.relatedWords.join(" · ")}</p>
            </Section>
          )}
          {w.otherSenses && (
            <Section label="Other meanings">
              <ul className="flex flex-col gap-1.5">
                {w.otherSenses.map((s) => (
                  <li key={s.definition} className="leading-relaxed">
                    {s.partOfSpeech && <span className="italic text-muted">{s.partOfSpeech} · </span>}
                    {s.definition}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-5 text-sm">
            <dt className="text-muted">Category</dt>
            <dd>{w.discoveryCategories.map((c) => CATEGORY_INFO[c].label).join(" · ")}</dd>
            {w.descriptors && (
              <>
                <dt className="text-muted">Usage</dt>
                <dd>{w.descriptors.map(capitalize).join(" · ")}</dd>
              </>
            )}
            {levelLabel({ level: w.level, cefrSource: w.cefrSource, tier: w.tier }) && (
              <>
                <dt className="text-muted">Level</dt>
                <dd>
                  {levelLabel({ level: w.level, cefrSource: w.cefrSource, tier: w.tier })}{" "}
                  <span className="text-muted">
                    · {w.level && w.cefrSource
                      ? CEFR_SOURCE_INFO[w.cefrSource].official
                        ? `CEFR, from the ${CEFR_SOURCE_INFO[w.cefrSource].label}`
                        : `${CEFR_SOURCE_INFO[w.cefrSource].label}, not an official CEFR rating`
                      : `${DIFFICULTY_INFO[w.tier!].label}: beyond the CEFR word lists. C2+ is this app's tier, not an official CEFR level`}
                  </span>
                </dd>
              </>
            )}
            {w.rarity && w.frequency !== undefined && (
              <>
                <dt className="text-muted">Rarity</dt>
                <dd>
                  {RARITY_INFO[w.rarity].label}{" "}
                  <span className="text-muted">
                    · {w.frequency > 0 ? `about ${fmtPerMillion(perMillion(w.frequency))} per million words` : "too rare for the frequency lists"}
                  </span>
                </dd>
              </>
            )}
            {w.styles && (
              <>
                <dt className="text-muted">Style</dt>
                <dd>{w.styles.map((s) => STYLE_INFO[s].label).join(" · ")}</dd>
              </>
            )}
            <dt className="text-muted">Discovered</dt>
            <dd>{fmtDate(w.firstSeenAt)}</dd>
          </dl>
        </div>
      </article>

      <div className="mt-auto flex flex-col pt-10">
        <button onClick={() => setConfirming("remove")} className="h-12 rounded-2xl text-sm font-semibold text-muted active:bg-line">
          Remove from Your Words
        </button>
        <button onClick={() => setConfirming("forget")} className="h-12 rounded-2xl text-sm font-semibold text-bad active:bg-line">
          Forget Word
        </button>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === "forget" ? "Forget this word?" : "Remove from Your Words?"}
        confirmLabel={confirming === "forget" ? "Forget Word" : "Remove"}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
      >
        {confirming === "forget"
          ? "This will remove it from your vocabulary history and allow it to appear again in future discoveries."
          : "It disappears from your collection but stays in your history, so it won’t be discovered again."}
      </ConfirmDialog>
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">{label}</h3>
      {children}
    </section>
  );
}
