import { expect, test } from "bun:test";
import { CATEGORIES, DIFFICULTIES } from "./catalog";
import { countBorrows, countCarries, generateProblem } from "./generators";
import { describeError, isCorrect } from "./grading";

test("carry and borrow counting", () => {
  expect(countCarries([47, 38])).toBe(1);
  expect(countCarries([999, 1])).toBe(3);
  expect(countCarries([12, 34])).toBe(0);
  expect(countBorrows(427, 168)).toBe(2);
  expect(countBorrows(7003, 2896)).toBe(3);
  expect(countBorrows(82, 31)).toBe(0);
});

test("every generator yields gradeable integer problems at every difficulty", () => {
  for (const category of CATEGORIES) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < 300; i++) {
        const p = generateProblem(category, difficulty);
        const where = `${category}/${difficulty}: ${p.prompt} = ${p.answer}`;
        expect(Number.isInteger(p.answer), where).toBe(true);
        expect(p.skill.startsWith(`${category}.`), where).toBe(true);
        expect(p.prompt).not.toContain("NaN");
        expect(p.prompt).not.toContain("undefined");
        expect(isCorrect(p, String(p.answer)), where).toBe(true);
      }
    }
  }
});

test("difficulty specs are actually met", () => {
  for (let i = 0; i < 300; i++) {
    expect(generateProblem("subtraction", "easy").features.borrows).toBe(0);
    expect(generateProblem("subtraction", "hard").features.borrows as number).toBeGreaterThanOrEqual(2);
    expect(generateProblem("addition", "medium").features.carries as number).toBeGreaterThanOrEqual(1);
  }
});

test("grading and error shapes", () => {
  expect(isCorrect({ answer: 1000, tolerance: 0.1 }, "1090")).toBe(true);
  expect(isCorrect({ answer: 1000, tolerance: 0.1 }, "1200")).toBe(false);
  expect(isCorrect({ answer: -4 }, "-4")).toBe(true);
  expect(isCorrect({ answer: 4 }, "")).toBe(false);
  expect(describeError("subtraction", 259, "295")).toMatchObject({ difference: 36, transposed: true, direction: "high" });
  expect(describeError("multiplication", 420, "4200")?.placeValue).toBe(true);
  expect(describeError("algebra", -4, "4")?.signFlip).toBe(true);
  expect(describeError("percentages", 200, "180")?.percentOff).toBe(10);
  expect(describeError("addition", 5, "5")).toBeNull();
});
