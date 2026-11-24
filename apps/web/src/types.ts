import type { DiffMode, Goal, Lang, TestCase } from "@codequest/judge";

export interface Challenge {
  id: string;
  title: string;
  description: string;
  lang: Lang;
  mode: "code" | "term";
  template: string;
  judge?: string;
  goals: Goal[];
  requireAllGoals: boolean;
  presetFiles: Record<string, string>;
  termMode?: "script" | "explore";
  token?: string;
  hint?: string;
}

export interface JudgeConfig {
  id: string;
  cases: TestCase[];
}

export type { DiffMode, Goal, Lang, TestCase };
