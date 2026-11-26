/** Shared contracts. Pure TypeScript only — no browser or Node APIs (design §1.2 / AGENTS.md #3). */

export type Lang = "javascript" | "python" | "cpp" | "shell" | "java";

export interface RunRequest {
  lang: Lang;
  code: string;
  stdin: string;
  files?: Record<string, string>;
  timeoutMs: number;
}

export interface RunResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  logs?: string[];
}

/** 运行时与判题器共享的超时类型；Worker 边界至少应保留 name 与 exitCode。 */
export class RunTimeoutError extends Error {
  readonly exitCode = 124;
  constructor(message = "运行超时") {
    super(message);
    this.name = "RunTimeoutError";
  }
}

export type DiffMode = "exact" | "eol" | "ws" | "regex-line" | "numeric-tol";

export interface TestCase {
  id: string;
  name: string;
  stdin: string;
  expected: string;
  /** 默认 eol：忽略行尾空白与文件末尾换行（设计 §5.3）。 */
  mode?: DiffMode;
  weight?: number;
  /** 仅 numeric-tol 使用，默认 1e-6。 */
  tolerance?: number;
}

export interface JudgeConfig {
  cases: TestCase[];
}

export interface DiffLine {
  line: number;
  expected: string;
  actual: string;
}

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  mode: DiffMode;
  expected: string;
  actual: string;
  stderr: string;
  exitCode: number;
  /** 首个失败点的行级 diff（成功时为空）。 */
  diff: DiffLine[];
  reason: "ok" | "output" | "stderr" | "timeout" | "missing";
}

export interface JudgeResult {
  passed: boolean;
  /** 0–100，按 weight 加权。 */
  score: number;
  results: TestResult[];
  firstFailure: TestResult | null;
}

export type GoalCheck =
  | { kind: "source-regex"; pattern: string; flags?: string }
  | { kind: "source-not-regex"; pattern: string; flags?: string }
  | { kind: "output-contains"; value: string }
  | { kind: "output-regex"; pattern: string; flags?: string }
  | { kind: "exit-code"; value: number }
  | { kind: "file-exists"; path: string }
  | { kind: "command-stdout"; command: string; expect: string }
  | { kind: "testcase"; all?: boolean; id?: string };

export interface Goal {
  id: string;
  text: string;
  hint?: string;
  check: GoalCheck;
  hidden?: boolean;
}

export interface GoalContext {
  source: string;
  lastRun: RunResponse | null;
  files: Record<string, string>;
  testResults: TestResult[];
  /** 运行时在同会话中探测 file-exists / command-stdout 的结果。 */
  runtimeGoalResults?: Record<string, boolean>;
}

export interface GoalStatus {
  id: string;
  text: string;
  hint?: string;
  hidden?: boolean;
  done: boolean;
}
