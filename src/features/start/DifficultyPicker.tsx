"use client";

import Link from "next/link";
import { Screen } from "@/components/layout/Screen";
import { fmtPct, Meter } from "@/components/ui";
import { DIFFICULTIES, DIFFICULTY_INFO } from "@/features/problems/catalog";
import { rating } from "@/features/stats/aggregate";
import { useStoredData } from "@/lib/db";

const BLURB = {
  easy: "Small numbers, no carrying",
  medium: "Carrying, borrowing, common percentages",
  hard: "Multi-digit, awkward numbers, reverse problems",
  expert: "Multi-step and compound problems",
} as const;

export function DifficultyPicker() {
  const data = useStoredData();
  return (
    <Screen title="Choose difficulty">
      <div className="flex flex-col gap-3">
        {DIFFICULTIES.map((d) => {
          const r = data ? rating(data.attempts.filter((a) => a.difficulty === d)) : null;
          return (
            <Link key={d} href={`/start/${d}`} className="rounded-2xl border border-line bg-card p-4 active:bg-line">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{DIFFICULTY_INFO[d].label}</span>
                <span className="font-mono text-lg tabular-nums">{fmtPct(r)}</span>
              </div>
              <p className="mb-3 text-sm text-muted">{BLURB[d]}</p>
              <Meter value={r} />
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}
