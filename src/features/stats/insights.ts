import { DIFFICULTY_INFO, MODE_INFO, type Category } from "@/features/problems/catalog";
import { describeError } from "@/features/problems/grading";
import type { Attempt } from "@/types/models";
import { addDays, groupBy, inRange, MIN_SAMPLE, rating, startOfDay, summarize } from "./aggregate";

export type Insight = { tone: "good" | "bad" | "info"; text: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const label = (c: Category) => MODE_INFO[c].label.toLowerCase();
const skillLabel = (skill: string) => skill.split(".")[1].replaceAll("-", " ");

// Every insight below only fires when each group it compares has at least MIN_SAMPLE attempts.
// The wording describes what the data shows (which problems are missed), never a guessed cause.
export function buildInsights(attempts: Attempt[], now = Date.now()): Insight[] {
  const out: Insight[] = [];
  const byCategory = groupBy(attempts, (a) => a.category);

  // Strongest / weakest category.
  const rated = [...byCategory]
    .map(([c, as]) => ({ c, r: rating(as) }))
    .filter((x): x is { c: Category; r: number } => x.r !== null)
    .sort((a, b) => b.r - a.r);
  if (rated.length >= 2) {
    const best = rated[0];
    const worst = rated.at(-1)!;
    out.push({ tone: "good", text: `Your strongest skill is ${label(best.c)} (${pct(best.r)}).` });
    if (best.r - worst.r >= 0.05)
      out.push({ tone: "bad", text: `Your weakest skill is ${label(worst.c)} (${pct(worst.r)}). Practice it next.` });
  }

  // Last 30 days vs the 30 before, per category: accuracy and speed.
  const end = addDays(startOfDay(now), 1);
  const cur = { start: addDays(end, -30), end };
  const prev = { start: addDays(end, -60), end: cur.start };
  for (const [c, as] of byCategory) {
    const a = inRange(as, cur);
    const b = inRange(as, prev);
    if (a.length < MIN_SAMPLE || b.length < MIN_SAMPLE) continue;
    const [sa, sb] = [summarize(a), summarize(b)];
    const dAcc = sa.accuracy! - sb.accuracy!;
    if (Math.abs(dAcc) >= 0.05)
      out.push({
        tone: dAcc > 0 ? "good" : "bad",
        text: `Your ${label(c)} accuracy ${dAcc > 0 ? "improved" : "dropped"} by ${Math.round(Math.abs(dAcc) * 100)} points over the last 30 days.`,
      });
  }
  for (const [key, as] of groupBy(attempts, (a) => `${a.category}|${a.difficulty}`)) {
    const [c, d] = key.split("|") as [Category, keyof typeof DIFFICULTY_INFO];
    const a = inRange(as, cur);
    const b = inRange(as, prev);
    if (a.length < MIN_SAMPLE || b.length < MIN_SAMPLE) continue;
    const [ma, mb] = [summarize(a).avgMs!, summarize(b).avgMs!];
    if (Math.abs(ma - mb) / mb >= 0.1)
      out.push({
        tone: ma < mb ? "good" : "bad",
        text: `Your average time for ${DIFFICULTY_INFO[d].label.toLowerCase()} ${label(c)} ${ma < mb ? "dropped" : "rose"} from ${secs(mb)} to ${secs(ma)}.`,
      });
  }

  // Accurate but much slower at Expert than at Hard.
  for (const [c, as] of byCategory) {
    const hard = as.filter((a) => a.difficulty === "hard");
    const expert = as.filter((a) => a.difficulty === "expert");
    if (hard.length < MIN_SAMPLE || expert.length < MIN_SAMPLE) continue;
    const [sh, se] = [summarize(hard), summarize(expert)];
    if (se.accuracy! >= 0.8 && se.avgMs! >= 1.8 * sh.avgMs!)
      out.push({
        tone: "info",
        text: `Your ${label(c)} accuracy stays high at Expert (${pct(se.accuracy!)}), but your time more than ${se.avgMs! >= 2 * sh.avgMs! ? "doubles" : "rises sharply"}: ${secs(sh.avgMs!)} → ${secs(se.avgMs!)}.`,
      });
  }

  // Weakest sub-skill within a category, when it clearly lags the rest of that category.
  for (const [c, as] of byCategory) {
    const skills = [...groupBy(as, (a) => a.skill)].filter(([, s]) => s.length >= MIN_SAMPLE);
    if (skills.length < 2) continue;
    const scored = skills.map(([skill, s]) => ({ skill, acc: summarize(s).accuracy!, rest: summarize(as.filter((a) => a.skill !== skill)).accuracy! }));
    const worst = scored.sort((a, b) => b.rest - b.acc - (a.rest - a.acc))[0]; // largest gap first
    if (worst.rest - worst.acc >= 0.15)
      out.push({
        tone: "bad",
        text: `You miss ${label(c)} problems of the "${skillLabel(worst.skill)}" type more often: ${pct(worst.acc)} vs ${pct(worst.rest)} for other ${label(c)}.`,
      });
  }

  // Error shapes across recent misses.
  const misses = attempts.filter((a) => !a.isCorrect).slice(-100);
  if (misses.length >= MIN_SAMPLE) {
    const errors = misses.map((a) => describeError(a.category, a.correctAnswer, a.userInput)).filter((e) => e !== null);
    const transposed = errors.filter((e) => e.transposed).length;
    const placeValue = errors.filter((e) => e.placeValue).length;
    if (transposed >= 3 && transposed / misses.length >= 0.15)
      out.push({
        tone: "info",
        text: `${transposed} of your last ${misses.length} misses had the right digits in the wrong order. These look like entry slips rather than calculation errors.`,
      });
    if (placeValue >= 3 && placeValue / misses.length >= 0.1)
      out.push({ tone: "info", text: `${placeValue} of your last ${misses.length} misses were off by a factor of 10. Watch the place value.` });
  }

  return out;
}
