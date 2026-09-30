"use client";

import { useState, type ReactNode } from "react";
import { Screen } from "@/components/layout/Screen";
import { Card, fmtPct, fmtSecs, Meter } from "@/components/ui";
import { DIFFICULTIES, DIFFICULTY_INFO, MODE_INFO } from "@/features/problems/catalog";
import { useStoredData } from "@/lib/db";
import type { Attempt } from "@/types/models";
import { buckets, dayKey, groupBy, inRange, MIN_SAMPLE, periodRanges, PERIODS, summarize, type PeriodId } from "./aggregate";
import { Heatmap } from "./Heatmap";
import { buildInsights } from "./insights";
import { TrendChart } from "./TrendChart";

export function StatsScreen() {
  const data = useStoredData();
  const [period, setPeriod] = useState<PeriodId>("7d");
  const [now] = useState(() => Date.now());

  if (!data) return <Screen title="Stats">{null}</Screen>;
  if (!data.attempts.length)
    return (
      <Screen title="Stats">
        <p className="text-muted">No practice yet. Stats appear after your first session.</p>
      </Screen>
    );

  const { current, previous } = periodRanges(period, now);
  const cur = inRange(data.attempts, current);
  const prev = previous ? inRange(data.attempts, previous) : null;
  const insights = buildInsights(data.attempts, now);
  const showTrends = period !== "today" && period !== "yesterday" && cur.length > 0;
  const trend = showTrends ? buckets(cur, current) : [];

  return (
    <Screen title="Stats">
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === period}
            onClick={() => setPeriod(p.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${
              p.id === period ? "border-accent bg-accent text-accent-ink" : "border-line bg-card"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Kpis cur={cur} prev={prev} />

      {insights.length > 0 && (
        <Section title="Insights">
          <ul className="flex flex-col gap-2 text-sm">
            {insights.map((i) => (
              <li key={i.text} className="flex gap-2">
                <span aria-hidden className={i.tone === "good" ? "text-good" : i.tone === "bad" ? "text-bad" : "text-muted"}>
                  {i.tone === "good" ? "▲" : i.tone === "bad" ? "▼" : "●"}
                </span>
                {i.text}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {insights.length === 0 && (
        <p className="mt-6 text-sm text-muted">Insights appear once you have about {MIN_SAMPLE} problems in a few different skills.</p>
      )}

      <Section title="Activity">
        <Heatmap attempts={data.attempts} now={now} />
      </Section>

      {showTrends && (
        <Section title="Progress">
          <div className="flex flex-col gap-6">
            <TrendChart title="Problems solved" data={trend} value={(b) => (b.attempts.length ? b.attempts.length : null)} format={String} />
            <TrendChart title="Accuracy" data={trend} value={(b) => summarize(b.attempts).accuracy} format={(v) => fmtPct(v)} domainMax={1} />
            <TrendChart title="Average time" data={trend} value={(b) => summarize(b.attempts).avgMs} format={(v) => fmtSecs(v)} />
          </div>
        </Section>
      )}

      {cur.length > 0 && (
        <>
          <Section title="By skill">
            <div className="flex flex-col gap-1">
              {[...groupBy(cur, (a) => a.category)]
                .sort((a, b) => b[1].length - a[1].length)
                .map(([c, as]) => (
                  <details key={c} className="group">
                    <summary className="cursor-pointer list-none">
                      <Row label={`${MODE_INFO[c].emoji} ${MODE_INFO[c].label}`} attempts={as} />
                    </summary>
                    <div className="mb-2 ml-7 flex flex-col">
                      {[...groupBy(as, (a) => a.skill)].map(([skill, ss]) => (
                        <Row key={skill} label={skill.split(".")[1].replaceAll("-", " ")} attempts={ss} small />
                      ))}
                    </div>
                  </details>
                ))}
            </div>
            <p className="mt-2 text-xs text-muted">Tap a skill to see its sub-skills.</p>
          </Section>

          <Section title="By difficulty">
            {DIFFICULTIES.map((d) => {
              const as = cur.filter((a) => a.difficulty === d);
              return as.length ? <Row key={d} label={DIFFICULTY_INFO[d].label} attempts={as} /> : null;
            })}
          </Section>
        </>
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <Card>{children}</Card>
    </section>
  );
}

// Doubles as the table view: every value is printed, the meter is decoration.
function Row({ label, attempts, small = false }: { label: string; attempts: Attempt[]; small?: boolean }) {
  const s = summarize(attempts);
  return (
    <div className={`grid grid-cols-[1fr_4.5rem_3rem_3.5rem] items-center gap-2 py-1.5 ${small ? "text-xs" : "text-sm"}`}>
      <span className="truncate capitalize">{label}</span>
      <Meter value={s.accuracy} />
      <span className="text-right font-mono tabular-nums" title={`${s.correct}/${s.total} correct`}>
        {fmtPct(s.accuracy)}
      </span>
      <span className="text-right font-mono text-muted tabular-nums">{fmtSecs(s.avgMs)}</span>
    </div>
  );
}

function Kpis({ cur, prev }: { cur: Attempt[]; prev: Attempt[] | null }) {
  const a = summarize(cur);
  const b = prev?.length ? summarize(prev) : null;
  const sessionScore = (as: Attempt[]) => {
    const scores = [...groupBy(as, (x) => x.sessionId).values()].map((s) => summarize(s).score);
    return scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
  };
  const activeDays = (as: Attempt[]) => new Set(as.map((x) => dayKey(x.createdAt))).size;

  const tiles: { label: string; value: string; delta: number | null; unit: string; lowerIsBetter?: boolean; digits?: number }[] = [
    { label: "Accuracy", value: fmtPct(a.accuracy), delta: b && a.accuracy !== null ? (a.accuracy - b.accuracy!) * 100 : null, unit: " pts", digits: 1 },
    { label: "Avg time", value: fmtSecs(a.avgMs), delta: b && a.avgMs !== null ? (a.avgMs - b.avgMs!) / 1000 : null, unit: "s", lowerIsBetter: true, digits: 2 },
    { label: "Problems", value: String(a.total), delta: b ? a.total - b.total : prev ? a.total : null, unit: "" },
    { label: "Best streak", value: String(a.bestStreak), delta: b ? a.bestStreak - b.bestStreak : null, unit: "" },
    {
      label: "Avg score",
      value: sessionScore(cur)?.toFixed(0) ?? "—",
      delta: b && cur.length ? sessionScore(cur)! - sessionScore(prev!)! : null,
      unit: "",
    },
    { label: "Days active", value: String(activeDays(cur)), delta: b ? activeDays(cur) - activeDays(prev!) : null, unit: "" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tiles.map((t) => {
        const good = t.delta !== null && t.delta !== 0 && t.delta < 0 === !!t.lowerIsBetter;
        return (
          <div key={t.label} className="rounded-2xl border border-line bg-card p-3">
            <p className="text-xs text-muted">{t.label}</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">{t.value}</p>
            <p className={`text-xs tabular-nums ${t.delta === null || t.delta === 0 ? "text-muted" : good ? "text-good" : "text-bad"}`}>
              {t.delta === null
                ? "no previous data"
                : t.delta === 0
                  ? "same as before"
                  : `${t.delta > 0 ? "↑" : "↓"} ${Math.abs(t.delta).toFixed(t.digits ?? 0)}${t.unit} vs previous`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
