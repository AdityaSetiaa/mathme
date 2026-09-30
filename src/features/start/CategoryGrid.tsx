"use client";

import Link from "next/link";
import { Screen } from "@/components/layout/Screen";
import { fmtPct, Meter } from "@/components/ui";
import { CATEGORIES, DIFFICULTY_INFO, MODE_INFO, type Difficulty, type Mode } from "@/features/problems/catalog";
import { rating } from "@/features/stats/aggregate";
import { useStoredData } from "@/lib/db";

const MODES: Mode[] = [...CATEGORIES, "mixed"];

export function CategoryGrid({ difficulty }: { difficulty: Difficulty }) {
  const data = useStoredData();
  return (
    <Screen title={`${DIFFICULTY_INFO[difficulty].label}: pick a skill`} back="/start">
      <div className="grid grid-cols-2 gap-3">
        {MODES.map((mode) => {
          const mine = data?.attempts.filter((a) => mode === "mixed" || a.category === mode) ?? [];
          const overall = rating(mine);
          const level = rating(mine.filter((a) => a.difficulty === difficulty));
          return (
            <Link
              key={mode}
              href={`/practice?difficulty=${difficulty}&mode=${mode}`}
              className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-card px-3 pb-3 pt-4 active:bg-line"
            >
              <span className="text-3xl" aria-hidden>
                {MODE_INFO[mode].emoji}
              </span>
              <span className="font-semibold">{MODE_INFO[mode].label}</span>
              <div className="mt-2 w-full">
                <Meter value={level} />
              </div>
              <div className="flex w-full justify-between text-xs text-muted tabular-nums">
                <span>
                  This level <b className="text-ink">{fmtPct(level)}</b>
                </span>
                <span>
                  All <b className="text-ink">{fmtPct(overall)}</b>
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}
