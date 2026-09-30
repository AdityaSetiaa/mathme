export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CATEGORIES = [
  "addition",
  "subtraction",
  "multiplication",
  "division",
  "percentages",
  "fractions",
  "ratios",
  "powers",
  "roots",
  "sequences",
  "estimation",
  "algebra",
] as const;
export type Category = (typeof CATEGORIES)[number];

// "mixed" is a session mode, never stored on an attempt: each mixed attempt keeps its real category.
export type Mode = Category | "mixed";

// Fine-grained skill, namespaced by category: "subtraction.multi-borrow".
export type SkillId = `${Category}.${string}`;

// Facts about one generated problem (borrow count, digit count…), recorded so analysis can group by them.
export type Features = Record<string, number | boolean>;

export type Problem = {
  category: Category;
  skill: SkillId;
  difficulty: Difficulty;
  prompt: string;
  answer: number;
  features: Features;
  tolerance?: number; // relative, e.g. 0.1 = within 10% (estimation)
};

export const DIFFICULTY_INFO: Record<Difficulty, { label: string; multiplier: number }> = {
  easy: { label: "Easy", multiplier: 1 },
  medium: { label: "Medium", multiplier: 2 },
  hard: { label: "Hard", multiplier: 3 },
  expert: { label: "Expert", multiplier: 4 },
};

export const MODE_INFO: Record<Mode, { label: string; emoji: string }> = {
  addition: { label: "Addition", emoji: "➕" },
  subtraction: { label: "Subtraction", emoji: "➖" },
  multiplication: { label: "Multiplication", emoji: "✖️" },
  division: { label: "Division", emoji: "➗" },
  percentages: { label: "Percentages", emoji: "💯" },
  fractions: { label: "Fractions", emoji: "🍕" },
  ratios: { label: "Ratios", emoji: "⚖️" },
  powers: { label: "Powers", emoji: "⚡" },
  roots: { label: "Roots", emoji: "🌱" },
  sequences: { label: "Sequences", emoji: "🔢" },
  estimation: { label: "Estimation", emoji: "🎯" },
  algebra: { label: "Algebra", emoji: "🧩" },
  mixed: { label: "Mixed", emoji: "🎲" },
};

export const isDifficulty = (s: unknown): s is Difficulty => DIFFICULTIES.includes(s as Difficulty);
export const isMode = (s: unknown): s is Mode => s === "mixed" || CATEGORIES.includes(s as Category);

// Categories where "how close" is best judged as a percentage of the answer rather than an absolute gap.
export const RELATIVE_ERROR_CATEGORIES: ReadonlySet<Category> = new Set(["percentages", "estimation", "ratios"]);
