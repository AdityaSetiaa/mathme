"use client";

import { useState } from "react";
import type { Bucket } from "./aggregate";

// One series per chart (no dual axes). Tap or hover a column to read its value; empty buckets draw no bar.
export function TrendChart({
  title,
  data,
  value,
  format,
  domainMax,
}: {
  title: string;
  data: Bucket[];
  value: (b: Bucket) => number | null;
  format: (v: number) => string;
  domainMax?: number; // fixed top of the scale (1 for accuracy); otherwise the largest value
}) {
  const values = data.map(value);
  const max = domainMax ?? Math.max(0, ...values.map((v) => v ?? 0));
  const lastWithData = values.findLastIndex((v) => v !== null);
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? lastWithData;
  const selValue = values[sel];

  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{title}</span>
        {sel >= 0 && (
          <span className="text-muted tabular-nums">
            {data[sel].label}: <b className="text-ink">{selValue === null ? "no data" : format(selValue)}</b>
          </span>
        )}
      </figcaption>
      <div className="flex h-24 items-end border-b border-line" onPointerLeave={() => setPicked(null)}>
        {data.map((b, i) => {
          const v = values[i];
          return (
            <button
              key={b.start}
              className="flex h-full min-w-0 flex-1 items-end justify-center px-px"
              onPointerEnter={(e) => e.pointerType === "mouse" && setPicked(i)}
              onClick={() => setPicked(i)}
              aria-label={`${b.label}: ${v === null ? "no data" : format(v)}`}
            >
              {v !== null && max > 0 && (
                <span
                  className={`block w-full max-w-6 rounded-t-[4px] bg-accent ${i === sel ? "" : "opacity-60"}`}
                  style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </figure>
  );
}
