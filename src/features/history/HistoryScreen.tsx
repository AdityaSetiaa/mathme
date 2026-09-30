"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Screen } from "@/components/layout/Screen";
import { fmtPct, fmtSecs } from "@/components/ui";
import { DIFFICULTY_INFO, MODE_INFO } from "@/features/problems/catalog";
import { describeError } from "@/features/problems/grading";
import { groupBy, summarize } from "@/features/stats/aggregate";
import { SummaryGrid } from "@/features/stats/SummaryGrid";
import { useStoredData } from "@/lib/db";
import type { Attempt, Session } from "@/types/models";

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
const fmtTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const title = (s: Session) => `${MODE_INFO[s.mode].label} · ${DIFFICULTY_INFO[s.difficulty].label}`;

export function HistoryScreen() {
  const id = useSearchParams().get("id");
  const data = useStoredData();
  if (!data) return <Screen title="History">{null}</Screen>;

  const bySession = groupBy(data.attempts, (a) => a.sessionId);
  const session = id ? data.sessions.find((s) => s.id === id) : null;
  if (session) return <SessionDetail session={session} attempts={bySession.get(session.id) ?? []} />;

  const sessions = data.sessions.filter((s) => bySession.has(s.id));
  if (!sessions.length)
    return (
      <Screen title="History">
        <p className="text-muted">No sessions yet. Finished and partial sessions show up here.</p>
      </Screen>
    );

  const byDay = groupBy(sessions, (s) => fmtDate(s.startedAt));
  return (
    <Screen title="History">
      <div className="flex flex-col gap-6">
        {[...byDay].map(([day, list]) => (
          <section key={day}>
            <h2 className="mb-2 text-sm font-semibold text-muted">{day}</h2>
            <ul className="flex flex-col gap-2">
              {list.map((s) => {
                const sum = summarize(bySession.get(s.id)!);
                return (
                  <li key={s.id}>
                    <Link href={`/history?id=${s.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 active:bg-line">
                      <span className="text-2xl" aria-hidden>
                        {MODE_INFO[s.mode].emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{title(s)}</p>
                        <p className="text-sm text-muted">
                          {sum.total} questions · {fmtTime(s.startedAt)}
                          {s.endedAt === null && " · incomplete"}
                        </p>
                      </div>
                      <div className="text-right font-mono text-sm tabular-nums">
                        <p className="font-semibold">{fmtPct(sum.accuracy)}</p>
                        <p className="text-muted">{fmtSecs(sum.avgMs)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}

function SessionDetail({ session, attempts }: { session: Session; attempts: Attempt[] }) {
  return (
    <Screen title={title(session)} back="/history">
      <p className="mb-4 text-sm text-muted">
        {fmtDate(session.startedAt)}, {fmtTime(session.startedAt)}
        {session.endedAt === null && " · incomplete"}
      </p>
      <SummaryGrid s={summarize(attempts)} />
      <ol className="mt-6 flex flex-col gap-2">
        {attempts.map((a) => {
          const err = describeError(a.category, a.correctAnswer, a.userInput);
          return (
            <li key={a.id} className="rounded-xl border border-line bg-card p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">
                  <span className={a.isCorrect ? "text-good" : "text-bad"} aria-label={a.isCorrect ? "Correct" : "Incorrect"}>
                    {a.isCorrect ? "✓" : "✗"}
                  </span>{" "}
                  {a.prompt}
                </span>
                <span className="shrink-0 font-mono text-sm text-muted tabular-nums">{fmtSecs(a.responseTimeMs)}</span>
              </div>
              <p className="mt-1 font-mono text-sm tabular-nums text-muted">
                You: <span className="text-ink">{a.userInput.replace("-", "−")}</span> · Answer:{" "}
                <span className="text-ink">{String(a.correctAnswer).replace("-", "−")}</span>
                {err && ` · off by ${err.difference}${err.percentOff !== null ? ` (${err.percentOff.toFixed(1)}%)` : ""}`}
              </p>
            </li>
          );
        })}
      </ol>
    </Screen>
  );
}
