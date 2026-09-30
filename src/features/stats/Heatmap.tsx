"use client";

import { useEffect, useRef, useState } from "react";
import type { Attempt } from "@/types/models";
import { addDays, dayKey, startOfDay } from "./aggregate";

const CELL = 12;
const GAP = 3;
const WEEKS = 53;

// GitHub-style: one column per week (Sun→Sat), one square per day, intensity = problems solved.
export function Heatmap({ attempts, now }: { attempts: Attempt[]; now: number }) {
  const counts = new Map<string, number>();
  for (const a of attempts) counts.set(dayKey(a.createdAt), (counts.get(dayKey(a.createdAt)) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());

  const today = startOfDay(now);
  const first = addDays(today, -((WEEKS - 1) * 7 + new Date(today).getDay()));
  const days: { t: number; count: number }[] = [];
  for (let t = first; t <= today; t = addDays(t, 1)) days.push({ t, count: counts.get(dayKey(t)) ?? 0 });

  const months = days
    .map((d, i) => ({ d, col: Math.floor(i / 7) + 1 }))
    .filter(({ d }) => new Date(d.t).getDate() === 1)
    .map(({ d, col }) => ({ col, label: new Date(d.t).toLocaleDateString(undefined, { month: "short" }) }));

  const [selected, setSelected] = useState(days.length - 1);
  const sel = days[Math.min(selected, days.length - 1)];

  // Start scrolled to the most recent weeks.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth });
  }, []);

  const level = (n: number) => (n === 0 ? 0 : Math.ceil((n / max) * 4));
  const grid = { gridAutoColumns: CELL, gap: GAP, gridAutoFlow: "column" } as const;

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="grid w-max text-[10px] text-muted" style={{ ...grid, gridTemplateRows: "14px" }}>
          {months.map((m) => (
            <span key={m.col} style={{ gridColumnStart: m.col }} className="whitespace-nowrap">
              {m.label}
            </span>
          ))}
        </div>
        <div className="grid w-max" style={{ ...grid, gridTemplateRows: `repeat(7, ${CELL}px)` }} role="grid" aria-label="Daily practice over the last year">
          {days.map((d, i) => (
            <button
              key={d.t}
              onClick={() => setSelected(i)}
              title={`${new Date(d.t).toDateString()}: ${d.count} problems`}
              aria-label={`${new Date(d.t).toDateString()}: ${d.count} problems`}
              className={`rounded-[3px] ${i === selected ? "outline-2 outline-offset-1 outline-ink" : ""}`}
              style={{ background: `var(--heat-${level(d.count)})` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>
          {new Date(sel.t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}:{" "}
          <b className="text-ink">{sel.count}</b> problems
        </span>
        <span className="flex items-center gap-1">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="inline-block size-2.5 rounded-[2px]" style={{ background: `var(--heat-${l})` }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
