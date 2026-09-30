import { DIFFICULTY_INFO } from "@/features/problems/catalog";
import type { Attempt } from "@/types/models";

// Below this many attempts a percentage is noise: show "—" instead, and generate no insight.
export const MIN_SAMPLE = 10;
// Ratings use recent attempts so they follow improvement instead of being anchored by old data.
const RATING_WINDOW = 50;

export type Summary = {
  total: number;
  correct: number;
  accuracy: number | null; // 0..1
  avgMs: number | null;
  fastestMs: number | null;
  slowestMs: number | null;
  bestStreak: number;
  score: number;
};

// ponytail: simple score = difficulty multiplier × (10 base + up to 10 speed bonus). Tune once real data exists.
export function attemptScore(a: Attempt): number {
  if (!a.isCorrect) return 0;
  const speedBonus = Math.max(0, 10 - a.responseTimeMs / 1000);
  return Math.round(DIFFICULTY_INFO[a.difficulty].multiplier * (10 + speedBonus));
}

export function summarize(attempts: Attempt[]): Summary {
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let totalMs = 0;
  let score = 0;
  let fastestMs = Infinity;
  let slowestMs = -Infinity;
  for (const a of attempts) {
    if (a.isCorrect) correct++;
    streak = a.isCorrect ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    totalMs += a.responseTimeMs;
    score += attemptScore(a);
    fastestMs = Math.min(fastestMs, a.responseTimeMs);
    slowestMs = Math.max(slowestMs, a.responseTimeMs);
  }
  const n = attempts.length;
  return {
    total: n,
    correct,
    accuracy: n ? correct / n : null,
    avgMs: n ? totalMs / n : null,
    fastestMs: n ? fastestMs : null,
    slowestMs: n ? slowestMs : null,
    bestStreak,
    score,
  };
}

/** Recent accuracy (0..1), or null when there is not enough data to mean anything. */
export function rating(attempts: Attempt[]): number | null {
  if (attempts.length < MIN_SAMPLE) return null;
  const recent = attempts.slice(-RATING_WINDOW);
  return recent.filter((a) => a.isCorrect).length / recent.length;
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const a of items) {
    const k = key(a);
    const list = groups.get(k);
    if (list) list.push(a);
    else groups.set(k, [a]);
  }
  return groups;
}

// ---------- calendar ----------

const DAY = 86_400_000;

export const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
// Via Date, not `+ n * DAY`, so DST changes don't shift day boundaries.
export const addDays = (t: number, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const PERIODS = [
  { id: "today", label: "Today", days: 1, offset: 0 },
  { id: "yesterday", label: "Yesterday", days: 1, offset: 1 },
  { id: "7d", label: "7 days", days: 7, offset: 0 },
  { id: "30d", label: "30 days", days: 30, offset: 0 },
  { id: "year", label: "Year", days: 365, offset: 0 },
  { id: "all", label: "All time", days: null, offset: 0 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

export type Range = { start: number; end: number };

/** The period's [start, end) and the equally long period just before it (null for all time). */
export function periodRanges(id: PeriodId, now = Date.now()): { current: Range; previous: Range | null } {
  const p = PERIODS.find((x) => x.id === id)!;
  if (p.days === null) return { current: { start: 0, end: Infinity }, previous: null };
  const end = addDays(startOfDay(now), 1 - p.offset);
  const start = addDays(end, -p.days);
  return { current: { start, end }, previous: { start: addDays(start, -p.days), end: start } };
}

export const inRange = (attempts: Attempt[], r: Range) => attempts.filter((a) => a.createdAt >= r.start && a.createdAt < r.end);

/** Consecutive days with practice, ending today (or yesterday, so the streak survives until you practice today). */
export function dayStreak(attempts: Attempt[], now = Date.now()): number {
  const days = new Set(attempts.map((a) => dayKey(a.createdAt)));
  let day = startOfDay(now);
  if (!days.has(dayKey(day))) day = addDays(day, -1);
  let streak = 0;
  while (days.has(dayKey(day))) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export type Bucket = { start: number; label: string; attempts: Attempt[] };

/** Split a range into day/week/month buckets depending on its length, for trend charts. */
export function buckets(attempts: Attempt[], r: Range): Bucket[] {
  if (!Number.isFinite(r.end)) {
    if (!attempts.length) return [];
    r = { start: startOfDay(attempts[0].createdAt), end: addDays(startOfDay(Date.now()), 1) };
  }
  const spanDays = Math.round((r.end - r.start) / DAY);
  const monthly = spanDays > 400;
  const stepDays = spanDays > 60 ? 7 : 1;
  const out: Bucket[] = [];
  let t = monthly ? new Date(r.start).setDate(1) : r.start;
  while (t < r.end) {
    const next = monthly ? new Date(new Date(t).setMonth(new Date(t).getMonth() + 1)).getTime() : addDays(t, stepDays);
    const d = new Date(t);
    out.push({
      start: t,
      label: monthly
        ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      attempts: [],
    });
    t = next;
  }
  let i = 0;
  for (const a of attempts) {
    if (a.createdAt < r.start || a.createdAt >= r.end) continue;
    while (i + 1 < out.length && a.createdAt >= out[i + 1].start) i++;
    out[i].attempts.push(a);
  }
  return out;
}
