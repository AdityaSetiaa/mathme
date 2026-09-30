import { fmtPct, fmtSecs } from "@/components/ui";
import type { Summary } from "./aggregate";

export function SummaryGrid({ s }: { s: Summary }) {
  const cells: [string, string][] = [
    ["Accuracy", fmtPct(s.accuracy)],
    ["Average", fmtSecs(s.avgMs)],
    ["Score", String(s.score)],
    ["Correct", String(s.correct)],
    ["Incorrect", String(s.total - s.correct)],
    ["Best streak", String(s.bestStreak)],
    ["Fastest", fmtSecs(s.fastestMs)],
    ["Slowest", fmtSecs(s.slowestMs)],
    ["Questions", String(s.total)],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-line bg-card px-3 py-2">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
