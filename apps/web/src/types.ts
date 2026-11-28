import type { DiffMode, Goal, Lang, TestCase } from "@codequest/judge";
import type { JudgeScriptInput } from "@codequest/rpgjs-script";

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

/** Existing OI workbench contract. Missing kind remains valid for legacy packs. */
export interface JudgeConfig {
  id: string;
  kind?: "oi";
  cases: TestCase[];
}

export type ScriptJudgeConfig = Omit<JudgeScriptInput, "source" | "kind"> & {
  id: string;
  kind: "script";
};

export type CourseJudgeConfig = JudgeConfig | ScriptJudgeConfig;

export type { DiffMode, Goal, Lang, TestCase };
