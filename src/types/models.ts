import type { Category, Difficulty, Features, Mode, SkillId } from "@/features/problems/catalog";

// Only raw facts are stored. Accuracy, streaks, scores, ratings and insights are all derived on read,
// so changing a formula later recomputes the whole history correctly.

export type Session = {
  id: string;
  mode: Mode;
  difficulty: Difficulty;
  plannedCount: number;
  startedAt: number; // epoch ms
  endedAt: number | null; // null = abandoned or in progress
};

export type Attempt = {
  id: string;
  sessionId: string;
  index: number; // position within the session
  category: Category;
  skill: SkillId;
  difficulty: Difficulty;
  prompt: string;
  features: Features;
  correctAnswer: number;
  tolerance?: number;
  userInput: string; // exactly what was typed
  isCorrect: boolean; // what the user was told at the time
  responseTimeMs: number; // performance.now() delta: monotonic, high resolution
  backspaces: number;
  createdAt: number; // Date.now(): wall clock, for calendar grouping
  generatorVersion: number;
};
