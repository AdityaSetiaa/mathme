import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-card p-4 ${className}`}>{children}</div>;
}

export function Meter({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </div>
  );
}

export const fmtPct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
export const fmtSecs = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)}s`);
