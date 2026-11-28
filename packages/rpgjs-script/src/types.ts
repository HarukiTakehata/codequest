import type { Limits, ListenerReport, ListenFilter, Program } from "@rpgjs/script/core";
import type {
  Diagnostic,
  ModuleSignals,
  SharedStore,
  SimulateResult,
  SimulatedWorld,
} from "@rpgjs/script/testing";

export type ScriptDiagnostic = Diagnostic;
export type ScriptEffect = SimulateResult["effects"][number];
export type ScriptState = NonNullable<SimulateResult["state"]>;
export type ScriptLimits = Limits;
export type ScriptSimulationResult = SimulateResult;

export interface ScriptCallSpec {
  fn: string;
  args?: unknown[];
}

export interface ScriptEmitSpec {
  signal: string;
  payload?: unknown;
}

/** One entry point for a simulation. Course files use call/fire/emit. */
export interface ScriptRunSpec {
  call?: ScriptCallSpec;
  event?: number;
  fire?: string;
  emit?: ScriptEmitSpec;
  world?: SimulatedWorld;
  limits?: ScriptLimits;
  signals?: ModuleSignals;
}

export interface CheckScriptOptions {
  catalog?: Record<string, string[]>;
  requiredExports?: string[];
  signals?: ModuleSignals;
}

export interface ScriptCheckResult {
  ok: boolean;
  diagnostics: ScriptDiagnostic[];
  warnings: ScriptDiagnostic[];
  exports: string[];
  handlers: string[];
  listeners: { signal: string; filter?: ListenFilter }[];
  events: { name?: string; pages: number }[];
  refs: { function: string; id: string; line: number }[];
  permissions: string[];
  shared: Program["shared"];
  /** Only present after a successful check. Never send this across a Worker boundary. */
  program?: Program;
}

export interface SimulateScriptInput extends ScriptRunSpec {
  source: string;
  catalog?: Record<string, string[]>;
  requiredExports?: string[];
}

export type ScriptExpectations = Record<string, unknown>;

export interface ScriptJudgeCase extends ScriptRunSpec {
  id?: string;
  name: string;
  weight?: number;
  dice?: number[];
  choices?: number[];
  expect: ScriptExpectations;
}

/** Shape shared by a script judge file and its Worker request. */
export interface JudgeScriptInput {
  id?: string;
  kind?: "script";
  source: string;
  /** Immutable starting point. A case's world is merged over this value. */
  init?: SimulatedWorld;
  cases: ScriptJudgeCase[];
  catalog?: Record<string, string[]>;
  requiredExports?: string[];
  limits?: ScriptLimits;
  signals?: ModuleSignals;
}

export interface ScriptVerdict {
  passed: boolean;
  failures: string[];
}

/** Audit record for one case/attempt. partialState is a flat dotted-path projection. */
export interface AttemptLedger {
  initHash: string;
  scriptHash: string;
  effects: ScriptEffect[];
  partialState: Record<string, unknown>;
  verdict: ScriptVerdict;
}

export interface ScriptCaseResult {
  id: string;
  name: string;
  weight: number;
  passed: boolean;
  failures: string[];
  result: ScriptSimulationResult;
  ledger: AttemptLedger;
}

export interface ScriptJudgeReport {
  /** Whether parsing/compilation succeeded. Assertion failures still have ok=true. */
  ok: boolean;
  passed: boolean;
  score: number;
  diagnostics?: ScriptDiagnostic[];
  error?: string;
  results: ScriptCaseResult[];
  ledgers: AttemptLedger[];
  uncovered: Record<string, string>;
}

export interface ScriptWorkerRequest extends JudgeScriptInput {
  timeoutMs?: number;
}

export type ScriptWorkerResponse = ScriptJudgeReport;

/** Useful for host integrations that need to construct a shared store themselves. */
export type { SharedStore };

/** Compile-time editor model corresponding to describeCourseApi(). */
export interface CoursePlayerApi {
  move(way: string, times: number): void;
}

export interface CourseGameApi {
  readonly player: CoursePlayerApi;
}

export type ScriptListenerReport = ListenerReport;
