import { CATEGORIES, type Category, type Difficulty, type Mode, type Problem, type SkillId } from "./catalog";

// Bump when a generator changes what it produces, so analysis can tell old data from new.
export const GENERATOR_VERSION = 1;

// Every generator returns an integer answer: the keypad only has digits and ±.
type Generated = Omit<Problem, "category" | "difficulty">;
type Generator = (d: Difficulty) => Generated;

// ---------- helpers ----------

export const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[rand(0, xs.length - 1)];
const ofDigits = (n: number) => rand(10 ** (n - 1), 10 ** n - 1);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const digitCount = (n: number) => String(Math.abs(n)).length;
const signed = (n: number) => (n < 0 ? ` − ${-n}` : ` + ${n}`);
const num = (n: number) => (n < 0 ? `−${-n}` : `${n}`);
const SUP: Record<string, string> = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n: number) => [...String(n)].map((c) => SUP[c]).join("");

// Regenerate until the problem has the structure the difficulty asks for (e.g. at least 2 borrows).
function until<T>(make: () => T, ok: (t: T) => boolean): T {
  for (let i = 0; i < 1000; i++) {
    const t = make();
    if (ok(t)) return t;
  }
  return make(); // unreachable for the specs below; engine.test.ts checks every generator
}

/** Number of columns that produce a carry when the numbers are added column by column. */
export function countCarries(nums: number[]): number {
  let carries = 0;
  let carry = 0;
  for (let place = 1; nums.some((n) => n >= place); place *= 10) {
    const column = nums.reduce((sum, n) => sum + (Math.floor(n / place) % 10), carry);
    carry = Math.floor(column / 10);
    if (carry) carries++;
  }
  return carries;
}

/** Number of columns that need a borrow when computing a − b (a ≥ b) column by column. */
export function countBorrows(a: number, b: number): number {
  let borrows = 0;
  let borrow = 0;
  for (; a > 0 || b > 0; a = Math.floor(a / 10), b = Math.floor(b / 10)) {
    borrow = (a % 10) - borrow < b % 10 ? 1 : 0;
    borrows += borrow;
  }
  return borrows;
}

// ---------- arithmetic ----------

const ADDITION: Record<Difficulty, { digits: number[]; minCarries: number; maxCarries: number }> = {
  easy: { digits: [2, 2], minCarries: 0, maxCarries: 1 },
  medium: { digits: [3, 3], minCarries: 1, maxCarries: 3 },
  hard: { digits: [4, 4], minCarries: 2, maxCarries: 4 },
  expert: { digits: [4, 3, 3], minCarries: 2, maxCarries: 5 },
};

const addition: Generator = (d) => {
  const spec = ADDITION[d];
  const nums = until(
    () => spec.digits.map(ofDigits),
    (ns) => {
      const c = countCarries(ns);
      return c >= spec.minCarries && c <= spec.maxCarries;
    },
  );
  const carries = countCarries(nums);
  const skill: SkillId =
    nums.length > 2 ? "addition.multi-operand" : carries === 0 ? "addition.basic" : "addition.carrying";
  return {
    skill,
    prompt: nums.join(" + "),
    answer: nums.reduce((a, b) => a + b, 0),
    features: { carries, operands: nums.length, digits: Math.max(...spec.digits) },
  };
};

const SUBTRACTION: Record<Difficulty, { a: number; b: number; minBorrows: number; maxBorrows: number }> = {
  easy: { a: 2, b: 2, minBorrows: 0, maxBorrows: 0 },
  medium: { a: 3, b: 3, minBorrows: 1, maxBorrows: 2 },
  hard: { a: 4, b: 3, minBorrows: 2, maxBorrows: 3 },
  expert: { a: 4, b: 4, minBorrows: 2, maxBorrows: 4 },
};

const subtraction: Generator = (d) => {
  const spec = SUBTRACTION[d];
  const [a, b] = until(
    () => [ofDigits(spec.a), ofDigits(spec.b)],
    ([a, b]) => {
      if (a <= b) return false;
      const n = countBorrows(a, b);
      return n >= spec.minBorrows && n <= spec.maxBorrows;
    },
  );
  const borrows = countBorrows(a, b);
  const features = { borrows, digits: spec.a, steps: 1 };
  if (d === "expert") {
    const c = ofDigits(3);
    return {
      skill: "subtraction.multi-step",
      prompt: `${a} − ${b} + ${c}`,
      answer: a - b + c,
      features: { ...features, steps: 2 },
    };
  }
  const skill: SkillId =
    borrows === 0 ? "subtraction.basic" : borrows === 1 ? "subtraction.borrow" : "subtraction.multi-borrow";
  return { skill, prompt: `${a} − ${b}`, answer: a - b, features };
};

const notRound = (n: number) => n % 10 !== 0 && n !== 11;

const MULTIPLICATION: Record<Difficulty, { a: [number, number]; b: [number, number]; skill: SkillId }> = {
  easy: { a: [2, 9], b: [2, 12], skill: "multiplication.tables" },
  medium: { a: [12, 99], b: [3, 9], skill: "multiplication.by-1-digit" },
  hard: { a: [12, 99], b: [12, 99], skill: "multiplication.2-by-2" },
  expert: { a: [101, 999], b: [12, 99], skill: "multiplication.3-by-2" },
};

const multiplication: Generator = (d) => {
  const { skill, ...spec } = MULTIPLICATION[d];
  // Multiples of 10 and 11 are trivial shortcuts, skip them outside the times tables.
  const operand = ([min, max]: [number, number]) => until(() => rand(min, max), (n) => max <= 12 || notRound(n));
  const [a, b] = [operand(spec.a), operand(spec.b)];
  return {
    skill,
    prompt: `${a} × ${b}`,
    answer: a * b,
    features: { digitsA: digitCount(a), digitsB: digitCount(b) },
  };
};

const DIVISION: Record<Difficulty, { divisor: [number, number]; quotient: [number, number]; skill: SkillId }> = {
  easy: { divisor: [2, 10], quotient: [2, 12], skill: "division.tables" },
  medium: { divisor: [3, 9], quotient: [12, 99], skill: "division.by-1-digit" },
  hard: { divisor: [11, 25], quotient: [11, 99], skill: "division.by-2-digit" },
  expert: { divisor: [12, 49], quotient: [101, 400], skill: "division.large" },
};

const division: Generator = (d) => {
  const spec = DIVISION[d];
  const divisor = rand(...spec.divisor);
  const quotient = rand(...spec.quotient);
  const dividend = divisor * quotient;
  return {
    skill: spec.skill,
    prompt: `${dividend} ÷ ${divisor}`,
    answer: quotient,
    features: { digitsDividend: digitCount(dividend), digitsDivisor: digitCount(divisor) },
  };
};

// ---------- percentages ----------

// A base that makes `base × p%` an integer. p may have one decimal (17.5), so work in tenths.
function percentBase(p: number, min: number, max: number) {
  const tenths = Math.round(p * 10);
  const step = 1000 / gcd(tenths, 1000);
  return step * rand(Math.max(1, Math.ceil(min / step)), Math.max(1, Math.floor(max / step)));
}

function percentOf(p: number, min: number, max: number): Generated {
  const base = percentBase(p, min, max);
  return {
    skill: "percentages.of-number",
    prompt: `${p}% of ${base}`,
    answer: Math.round((base * p) / 100),
    features: { percent: p, decimalPercent: !Number.isInteger(p) },
  };
}

function percentChange(p: number, up: boolean, min: number, max: number): Generated {
  const base = percentBase(p, min, max);
  return {
    skill: "percentages.change",
    prompt: `${base} ${up ? "increased" : "decreased"} by ${p}%`,
    answer: Math.round((base * (100 + (up ? p : -p))) / 100),
    features: { percent: p, increase: up },
  };
}

function percentReverse(p: number, min: number, max: number): Generated {
  const original = percentBase(p, min, max);
  const after = Math.round((original * (100 + p)) / 100);
  return {
    skill: "percentages.reverse",
    prompt: `After a ${p}% increase it is ${after}. Original?`,
    answer: original,
    features: { percent: p },
  };
}

const percentages: Generator = (d) => {
  switch (d) {
    case "easy":
      return percentOf(pick([10, 20, 25, 50, 75]), 20, 400);
    case "medium":
      return Math.random() < 0.6
        ? percentOf(pick([5, 15, 30, 35, 40, 45, 60, 70, 80, 90]), 100, 900)
        : percentChange(pick([10, 20, 25, 50]), Math.random() < 0.5, 40, 600);
    case "hard":
      return Math.random() < 0.6
        ? percentOf(pick([2.5, 7.5, 12.5, 17.5, 22.5, 37.5, 62.5, 87.5]), 200, 2000)
        : percentReverse(pick([10, 20, 25, 50]), 40, 800);
    case "expert": {
      if (Math.random() < 0.4) {
        const p = pick([15, 35, 45, 12.5, 17.5]);
        const whole = percentBase(p, 100, 2000);
        return {
          skill: "percentages.reverse",
          prompt: `${Math.round((whole * p) / 100)} is ${p}% of ?`,
          answer: whole,
          features: { percent: p },
        };
      }
      // Successive changes: (1 ± a)(1 ± b) − 1. Multiples of 10 keep the answer an integer.
      const a = rand(1, 5) * 10;
      const b = rand(1, 5) * 10;
      const [sa, sb] = [pick([1, -1]), pick([1, -1])];
      const word = (s: number) => (s > 0 ? "increased" : "decreased");
      return {
        skill: "percentages.successive",
        prompt: `A number is ${word(sa)} by ${a}%, then ${word(sb)} by ${b}%. Overall % change?`,
        answer: ((100 + sa * a) * (100 + sb * b) - 10000) / 100,
        features: { steps: 2 },
      };
    }
  }
};

// ---------- fractions & ratios ----------

const coprimeUnder = (d: number) => until(() => rand(2, d - 1), (a) => gcd(a, d) === 1);

const fractions: Generator = (d): Generated => {
  switch (d) {
    case "easy": {
      const den = rand(2, 10);
      const k = rand(2, 12);
      return { skill: "fractions.unit-of", prompt: `1/${den} of ${den * k}`, answer: k, features: { denominator: den } };
    }
    case "medium": {
      const den = rand(3, 12);
      const num = coprimeUnder(den);
      const k = rand(2, 15);
      return { skill: "fractions.of-number", prompt: `${num}/${den} of ${den * k}`, answer: num * k, features: { denominator: den } };
    }
    case "hard": {
      const den = rand(5, 12);
      const num = coprimeUnder(den);
      const k = rand(4, 20);
      return {
        skill: "fractions.reverse",
        prompt: `${num}/${den} of ? = ${num * k}`,
        answer: den * k,
        features: { denominator: den },
      };
    }
    case "expert": {
      const [d1, d2] = [rand(3, 9), rand(3, 9)];
      const [n1, n2] = [coprimeUnder(d1), coprimeUnder(d2)];
      const k = rand(2, 8);
      return {
        skill: "fractions.chained",
        prompt: `${n1}/${d1} of ${n2}/${d2} of ${d1 * d2 * k}`,
        answer: n1 * n2 * k,
        features: { steps: 2 },
      };
    }
  }
};

function reducedPair(max: number): [number, number] {
  return until(
    () => [rand(1, max), rand(1, max)] as [number, number],
    ([a, b]) => a !== b && gcd(a, b) === 1,
  );
}

const ratios: Generator = (d): Generated => {
  switch (d) {
    case "easy": {
      const [a, b] = reducedPair(9);
      const k = rand(2, 9);
      return { skill: "ratios.scale", prompt: `${a}:${b} = ${a * k}:?`, answer: b * k, features: { parts: 2 } };
    }
    case "medium": {
      const [a, b] = reducedPair(9);
      const k = rand(2, 20);
      const larger = Math.random() < 0.5;
      return {
        skill: "ratios.share",
        prompt: `Share ${(a + b) * k} in the ratio ${a}:${b}. ${larger ? "Larger" : "Smaller"} share?`,
        answer: (larger ? Math.max(a, b) : Math.min(a, b)) * k,
        features: { parts: 2 },
      };
    }
    case "hard": {
      const parts = until(
        () => [rand(1, 9), rand(1, 9), rand(1, 9)],
        (ps) => new Set(ps).size === 3 && gcd(gcd(ps[0], ps[1]), ps[2]) === 1,
      );
      const k = rand(3, 20);
      return {
        skill: "ratios.share-3",
        prompt: `Share ${parts.reduce((s, p) => s + p, 0) * k} in the ratio ${parts.join(":")}. Largest share?`,
        answer: Math.max(...parts) * k,
        features: { parts: 3 },
      };
    }
    case "expert": {
      // Missing value where the scale factor is not a whole number: 6:9 = ?:15.
      const [m, n] = reducedPair(9);
      const [k1, k2] = until(() => [rand(2, 9), rand(2, 9)], ([x, y]) => x !== y && x % y !== 0 && y % x !== 0);
      return {
        skill: "ratios.missing-value",
        prompt: `${m * k1}:${n * k1} = ?:${n * k2}`,
        answer: m * k2,
        features: { parts: 2, fractionalScale: true },
      };
    }
  }
};

// ---------- powers & roots ----------

const powers: Generator = (d) => {
  const square = (min: number, max: number): Generated => {
    const n = until(() => rand(min, max), (x) => x % 10 !== 0 || max <= 12);
    return { skill: "powers.square", prompt: `${n}²`, answer: n * n, features: { base: n, exponent: 2 } };
  };
  const cube = (min: number, max: number): Generated => {
    const n = rand(min, max);
    return { skill: "powers.cube", prompt: `${n}³`, answer: n ** 3, features: { base: n, exponent: 3 } };
  };
  const power = (base: number, min: number, max: number): Generated => {
    const e = rand(min, max);
    return { skill: "powers.power", prompt: `${base}${sup(e)}`, answer: base ** e, features: { base, exponent: e } };
  };
  switch (d) {
    case "easy":
      return square(2, 12);
    case "medium":
      return Math.random() < 0.6 ? square(13, 25) : cube(2, 5);
    case "hard":
      return pick([() => square(26, 60), () => cube(6, 10), () => power(2, 6, 12)])();
    case "expert":
      return pick([() => square(61, 130), () => cube(11, 15), () => power(3, 4, 7)])();
  }
};

const roots: Generator = (d) => {
  const sqrt = (min: number, max: number): Generated => {
    const n = until(() => rand(min, max), (x) => x % 10 !== 0 || max <= 12);
    return { skill: "roots.square-root", prompt: `√${n * n}`, answer: n, features: { root: 2 } };
  };
  const cbrt = (min: number, max: number): Generated => {
    const n = rand(min, max);
    return { skill: "roots.cube-root", prompt: `∛${n ** 3}`, answer: n, features: { root: 3 } };
  };
  switch (d) {
    case "easy":
      return sqrt(2, 12);
    case "medium":
      return Math.random() < 0.6 ? sqrt(13, 25) : cbrt(2, 5);
    case "hard":
      return Math.random() < 0.6 ? sqrt(26, 60) : cbrt(6, 10);
    case "expert":
      return Math.random() < 0.6 ? sqrt(61, 150) : cbrt(11, 20);
  }
};

// ---------- sequences ----------

// Show `terms` with one hidden: the last by default, or one in the middle.
function sequence(skill: SkillId, terms: number[], hideMiddle = false): Generated {
  const hidden = hideMiddle ? rand(1, terms.length - 2) : terms.length - 1;
  return {
    skill,
    prompt: terms.map((t, i) => (i === hidden ? "?" : t)).join(", "),
    answer: terms[hidden],
    features: { length: terms.length, missingMiddle: hideMiddle },
  };
}

const arithmeticTerms = (start: number, step: number, n: number) => Array.from({ length: n }, (_, i) => start + i * step);

const sequences: Generator = (d) => {
  switch (d) {
    case "easy":
      return sequence("sequences.arithmetic", arithmeticTerms(rand(1, 20), rand(2, 10), 5));
    case "medium":
      return Math.random() < 0.5
        ? sequence("sequences.arithmetic", arithmeticTerms(rand(60, 150), -rand(3, 15), 5), Math.random() < 0.5)
        : sequence("sequences.geometric", geometric(rand(1, 5), rand(2, 3), 5));
    case "hard": {
      // Differences grow by a constant: 3, 5, 9, 15, 23 (+2, +4, +6, +8).
      const start = rand(1, 20);
      let diff = rand(1, 6);
      const inc = rand(1, 4);
      const terms = [start];
      for (let i = 1; i < 6; i++, diff += inc) terms.push(terms[i - 1] + diff);
      return sequence("sequences.second-difference", terms, Math.random() < 0.3);
    }
    case "expert": {
      if (Math.random() < 0.5) {
        const terms = [rand(1, 9), rand(2, 12)];
        while (terms.length < 7) terms.push(terms.at(-1)! + terms.at(-2)!);
        return sequence("sequences.recursive", terms);
      }
      // Two interleaved arithmetic sequences: 3, 20, 7, 17, 11, 14, ?
      const a = arithmeticTerms(rand(1, 20), rand(2, 9), 4);
      const b = arithmeticTerms(rand(30, 60), -rand(2, 9), 4);
      return sequence("sequences.interleaved", a.flatMap((x, i) => [x, b[i]]).slice(0, 7));
    }
  }
};

function geometric(start: number, ratio: number, n: number) {
  return Array.from({ length: n }, (_, i) => start * ratio ** i);
}

// ---------- estimation ----------

const estimation: Generator = (d) => {
  const estimate = (skill: SkillId, prompt: string, exact: number, tolerance: number): Generated => ({
    skill,
    prompt: `≈ ${prompt}`,
    answer: Math.round(exact),
    tolerance,
    features: { tolerancePct: tolerance * 100 },
  });
  switch (d) {
    case "easy": {
      const [a, b] = [rand(12, 98), rand(12, 98)];
      return estimate("estimation.product", `${a} × ${b}`, a * b, 0.1);
    }
    case "medium": {
      const [a, b] = [rand(101, 999), rand(12, 98)];
      return estimate("estimation.product", `${a} × ${b}`, a * b, 0.1);
    }
    case "hard": {
      if (Math.random() < 0.5) {
        const [a, b] = [rand(1001, 9999), rand(12, 98)];
        return estimate("estimation.quotient", `${a} ÷ ${b}`, a / b, 0.05);
      }
      const [a, b] = [rand(101, 999), rand(101, 999)];
      return estimate("estimation.product", `${a} × ${b}`, a * b, 0.05);
    }
    case "expert": {
      if (Math.random() < 0.5) {
        const [p, n] = [rand(11, 89), rand(1001, 9999)];
        return estimate("estimation.percent", `${p}% of ${n}`, (p * n) / 100, 0.05);
      }
      const [a, b, c] = [rand(101, 999), rand(12, 98), rand(12, 98)];
      return estimate("estimation.compound", `${a} × ${b} ÷ ${c}`, (a * b) / c, 0.05);
    }
  }
};

// ---------- algebra ----------

const algebra: Generator = (d): Generated => {
  switch (d) {
    case "easy": {
      const x = rand(1, 50);
      const a = rand(2, 50);
      const plus = Math.random() < 0.5;
      return {
        skill: "algebra.one-step",
        prompt: `x${plus ? ` + ${a}` : ` − ${a}`} = ${num(plus ? x + a : x - a)}`,
        answer: x,
        features: { steps: 1 },
      };
    }
    case "medium": {
      const [x, a, b] = [rand(1, 15), rand(2, 9), rand(1, 30)];
      return { skill: "algebra.two-step", prompt: `${a}x + ${b} = ${a * x + b}`, answer: x, features: { steps: 2 } };
    }
    case "hard": {
      // ax + b = cx + e
      const x = rand(-10, 15);
      const [a, c] = until(() => [rand(2, 9), rand(1, 9)], ([a, c]) => a !== c);
      const b = rand(-20, 20);
      const e = (a - c) * x + b;
      const cx = c === 1 ? "x" : `${c}x`;
      return {
        skill: "algebra.both-sides",
        prompt: `${a}x${b ? signed(b) : ""} = ${cx}${e ? signed(e) : ""}`,
        answer: x,
        features: { steps: 3, negativeAnswer: x < 0 },
      };
    }
    case "expert": {
      // a(x + b) = cx + e
      const x = rand(-12, 12);
      const [a, c] = until(() => [rand(2, 9), rand(1, 9)], ([a, c]) => a !== c);
      const b = until(() => rand(-9, 9), (n) => n !== 0);
      const e = a * (x + b) - c * x;
      const cx = c === 1 ? "x" : `${c}x`;
      return {
        skill: "algebra.brackets",
        prompt: `${a}(x${signed(b)}) = ${cx}${e ? signed(e) : ""}`,
        answer: x,
        features: { steps: 3, negativeAnswer: x < 0 },
      };
    }
  }
};

// ---------- entry point ----------

const GENERATORS: Record<Category, Generator> = {
  addition,
  subtraction,
  multiplication,
  division,
  percentages,
  fractions,
  ratios,
  powers,
  roots,
  sequences,
  estimation,
  algebra,
};

export function generateProblem(mode: Mode, difficulty: Difficulty): Problem {
  const category = mode === "mixed" ? pick(CATEGORIES) : mode;
  return { category, difficulty, ...GENERATORS[category](difficulty) };
}
