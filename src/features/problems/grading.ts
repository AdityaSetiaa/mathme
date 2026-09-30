import { RELATIVE_ERROR_CATEGORIES, type Category } from "./catalog";

/** Keypad input ("", "-", "-42", "0259") → number, or null when there is no number yet. */
export function parseInput(input: string): number | null {
  if (!/^-?\d+$/.test(input)) return null;
  return Number(input);
}

export function isCorrect(problem: { answer: number; tolerance?: number }, input: string): boolean {
  const value = parseInput(input);
  if (value === null) return false;
  if (problem.tolerance) return Math.abs(value - problem.answer) <= problem.tolerance * Math.abs(problem.answer);
  return value === problem.answer;
}

export type ErrorInfo = {
  difference: number; // |user − correct|
  direction: "high" | "low";
  percentOff: number | null; // shown for categories where relative error matters
  // Observable shapes of a wrong answer. These describe the answer, not the cause.
  transposed: boolean; // same digits, different order: 259 → 295
  placeValue: boolean; // off by a factor of 10/100/1000
  signFlip: boolean; // right magnitude, wrong sign
};

export function describeError(category: Category, correct: number, input: string): ErrorInfo | null {
  const value = parseInput(input);
  if (value === null || value === correct) return null;
  const sorted = (n: number) => [...String(Math.abs(n))].sort().join("");
  const ratio = correct !== 0 && value !== 0 ? Math.abs(value / correct) : 0;
  return {
    difference: Math.abs(value - correct),
    direction: value > correct ? "high" : "low",
    percentOff:
      RELATIVE_ERROR_CATEGORIES.has(category) && correct !== 0 ? (Math.abs(value - correct) / Math.abs(correct)) * 100 : null,
    transposed: Math.abs(value) !== Math.abs(correct) && sorted(value) === sorted(correct),
    placeValue: [10, 100, 1000, 0.1, 0.01, 0.001].some((f) => Math.abs(ratio - f) < 1e-9),
    signFlip: value === -correct,
  };
}
