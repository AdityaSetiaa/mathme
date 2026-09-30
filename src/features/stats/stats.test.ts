import { expect, test } from "bun:test";
import type { Attempt } from "@/types/models";
import { addDays, dayStreak, periodRanges, rating, startOfDay, summarize } from "./aggregate";
import { buildInsights } from "./insights";

const NOW = new Date(2026, 8, 30, 15).getTime();
let n = 0;
const at = (p: Partial<Attempt>): Attempt => ({
  id: String(n++),
  sessionId: "s",
  index: 0,
  category: "addition",
  skill: "addition.basic",
  difficulty: "medium",
  prompt: "",
  features: {},
  correctAnswer: 259,
  userInput: "259",
  isCorrect: true,
  responseTimeMs: 3000,
  backspaces: 0,
  createdAt: NOW,
  generatorVersion: 1,
  ...p,
});

test("summary streaks and ratings respect the minimum sample", () => {
  const s = summarize([at({}), at({}), at({ isCorrect: false }), at({}), at({}), at({})]);
  expect(s).toMatchObject({ total: 6, correct: 5, bestStreak: 3 });
  expect(rating(Array.from({ length: 9 }, () => at({})))).toBeNull();
  expect(rating(Array.from({ length: 10 }, () => at({})))).toBe(1);
});

test("periods and day streaks", () => {
  const { current, previous } = periodRanges("7d", NOW);
  expect(current.end).toBe(addDays(startOfDay(NOW), 1));
  expect(previous!.end).toBe(current.start);
  expect(periodRanges("all", NOW).previous).toBeNull();
  const days = [0, -1, -2, -4].map((d) => at({ createdAt: addDays(NOW, d) }));
  expect(dayStreak(days, NOW)).toBe(3);
  expect(dayStreak(days.slice(1), NOW)).toBe(2); // not practiced yet today: streak still counts
});

test("insights only claim what the data shows", () => {
  expect(buildInsights([at({})], NOW)).toEqual([]);

  const history = [
    ...Array.from({ length: 20 }, () => at({ category: "addition", skill: "addition.basic" })),
    ...Array.from({ length: 20 }, (_, i) => at({ category: "subtraction", skill: "subtraction.basic", isCorrect: i < 19 })),
    ...Array.from({ length: 20 }, (_, i) =>
      at({ category: "subtraction", skill: "subtraction.multi-borrow", isCorrect: i < 10, userInput: i < 10 ? "259" : "295" }),
    ),
  ];
  const text = buildInsights(history, NOW).map((i) => i.text).join("\n");
  expect(text).toContain("strongest skill is addition");
  expect(text).toContain("weakest skill is subtraction");
  expect(text).toContain('"multi borrow"');
  expect(text).toContain("right digits in the wrong order");
});
