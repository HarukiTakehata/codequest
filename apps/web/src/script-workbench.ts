import {
  evaluateGoals,
  type Goal,
  type GoalStatus,
  type JudgeResult,
  type RunResponse,
  type TestResult,
} from "@codequest/judge";

export interface ScriptDiagnostic {
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface ScriptEffect {
  name: string;
  params: unknown;
}

export interface ScriptRunViewModel {
  run: RunResponse;
  diagnostics: ScriptDiagnostic[];
  state: unknown;
  effects: ScriptEffect[];
  value: unknown;
}

export interface ScriptWorkbenchViewModel {
  diagnostics: ScriptDiagnostic[];
  run: RunResponse | null;
  verdict: JudgeResult | null;
  goals: GoalStatus[];
  state: unknown;
  effects: ScriptEffect[];
  details: Record<string, unknown>;
}

export interface ScriptAttemptState {
  challengeId: string | null;
  passNotified: boolean;
}

export interface ScriptPassPayload {
  score: number;
  code: string;
  files: Record<string, string>;
  effects: ScriptEffect[];
  state: unknown;
}

export interface ScriptAttemptTransition {
  state: ScriptAttemptState;
  onPass: ScriptPassPayload | null;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function display(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function diagnostic(value: unknown): ScriptDiagnostic | null {
  if (typeof value === "string") {
    return { line: 1, message: value, severity: "error" };
  }
  const item = record(value);
  if (!item) return null;
  const message = typeof item.message === "string" ? item.message : display(item.error ?? item.reason);
  if (!message) return null;
  const rawLine = finiteNumber(item.line) ?? 1;
  const severity = item.severity === "warning" || item.severity === "warn"
    ? "warning"
    : item.severity === "info" || item.severity === "information"
      ? "info"
      : "error";
  return {
    line: Math.max(1, Math.trunc(rawLine)),
    message,
    severity,
  };
}

function collectDiagnostics(values: unknown[]): ScriptDiagnostic[] {
  const found = new Map<string, ScriptDiagnostic>();
  for (const value of values) {
    for (const raw of array(value)) {
      const item = diagnostic(raw);
      if (!item) continue;
      const key = `${item.severity}:${item.line}:${item.message}`;
      if (!found.has(key)) found.set(key, item);
    }
  }
  return [...found.values()];
}

/** Normalize compiler/runtime diagnostics, including RPGJS's whole-script line 0. */
export function adaptScriptDiagnostics(result: unknown): ScriptDiagnostic[] {
  const root = record(result);
  if (!root) return collectDiagnostics([result]);
  const values: unknown[] = [root.diagnostics, root.errors];
  values.push(array(root.warnings).map((value) => {
    const item = record(value);
    return item ? { ...item, severity: "warning" } : value;
  }));
  if (typeof root.error === "string") values.push([{ line: 1, message: root.error }]);
  for (const test of [...array(root.results), ...array(root.tests)]) {
    const item = record(test);
    if (!item) continue;
    values.push(item.diagnostics, item.errors);
    const simulation = record(item.result) ?? record(item.simulation);
    if (simulation) {
      values.push(simulation.diagnostics, simulation.errors);
      if (typeof simulation.error === "string") values.push([{ line: 1, message: simulation.error }]);
    }
  }
  return collectDiagnostics(values);
}

function normalizedRoot(result: unknown): UnknownRecord {
  const envelope = record(result) ?? {};
  const verdict = record(envelope.verdict);
  return verdict ? { ...envelope, ...verdict } : envelope;
}

function simulationOf(root: UnknownRecord): UnknownRecord | null {
  const direct = record(root.simulation) ?? record(root.result);
  if (direct) return direct;
  const firstResult = record(array(root.results)[0]);
  return record(firstResult?.result);
}

function stateOf(root: UnknownRecord): unknown {
  const simulation = simulationOf(root);
  const attempt = record(root.attempt);
  const firstLedger = record(array(root.ledgers)[0]);
  return root.state ?? root.partialState ?? simulation?.state ?? firstLedger?.partialState ?? attempt?.partialState ?? attempt?.state;
}

function effectsOf(root: UnknownRecord): ScriptEffect[] {
  const simulation = simulationOf(root);
  const attempt = record(root.attempt);
  const values = root.effects
    ?? (array(root.ledgers).length > 0
      ? array(root.ledgers).flatMap((ledger) => array(record(ledger)?.effects))
      : simulation?.effects)
    ?? attempt?.effects;
  return array(values).flatMap((value) => {
    const item = record(value);
    if (!item) return [];
    return [{
      name: typeof item.name === "string" ? item.name : "",
      params: item.params ?? item.args ?? item,
    }];
  }).filter((effect) => effect.name.length > 0);
}

function executionOk(root: UnknownRecord, simulation: UnknownRecord | null): boolean | null {
  for (const candidate of [simulation?.ok, simulation?.success, root.ok, root.success]) {
    if (typeof candidate === "boolean") return candidate;
  }
  return null;
}

/** Turn a Worker simulation response into the existing run-output shape. */
export function adaptScriptRunResult(result: unknown): ScriptRunViewModel {
  const root = normalizedRoot(result);
  const simulation = simulationOf(root);
  const diagnostics = adaptScriptDiagnostics(result);
  const state = stateOf(root);
  const effects = effectsOf(root);
  const value = root.value ?? simulation?.value;
  const ok = executionOk(root, simulation);
  const error = typeof root.error === "string"
    ? root.error
    : typeof simulation?.error === "string"
      ? simulation.error
      : diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("\n");
  const stdout = typeof root.stdout === "string"
    ? root.stdout
    : typeof simulation?.stdout === "string"
      ? simulation.stdout
      : display(value !== undefined || state !== undefined || effects.length > 0
        ? { value, effects, state }
        : undefined);
  const stderr = typeof root.stderr === "string"
    ? root.stderr
    : typeof simulation?.stderr === "string"
      ? simulation.stderr
      : error;
  const exitCode = finiteNumber(root.exitCode)
    ?? finiteNumber(simulation?.exitCode)
    ?? (ok === false || error ? 1 : 0);
  const logs = array(root.logs ?? simulation?.logs).map(display).filter(Boolean);
  return {
    run: { stdout, stderr, exitCode, logs },
    diagnostics,
    state,
    effects,
    value,
  };
}

function testPassed(test: UnknownRecord): boolean {
  for (const candidate of [test.passed, test.pass, test.ok]) {
    if (typeof candidate === "boolean") return candidate;
  }
  const simulation = record(test.result) ?? record(test.simulation);
  if (simulation && typeof simulation.ok === "boolean") return simulation.ok;
  if (Array.isArray(test.failures)) return test.failures.length === 0;
  return false;
}

function testFailure(test: UnknownRecord, simulation: UnknownRecord | null): string {
  if (Array.isArray(test.failures) && test.failures.length > 0) return test.failures.map(display).join("\n");
  if (typeof test.error === "string") return test.error;
  if (typeof simulation?.error === "string") return simulation.error;
  if (Array.isArray(test.messages)) return test.messages.map(display).join("\n");
  return "";
}

function adaptTests(root: UnknownRecord): TestResult[] {
  const report = record(root.report);
  const values = array(root.results ?? root.tests ?? report?.results ?? report?.tests);
  return values.flatMap((value, index) => {
    const test = record(value);
    if (!test) return [];
    const simulation = record(test.result) ?? record(test.simulation);
    const passed = testPassed(test);
    const failure = testFailure(test, simulation);
    const timedOut = /timed?\s*out|timeout/i.test(failure);
    const expected = test.expected ?? test.expect ?? simulation?.expected;
    const actual = test.actual ?? simulation?.actual ?? simulation?.state ?? simulation?.value ?? failure;
    const name = typeof test.name === "string" && test.name
      ? test.name
      : `Test ${index + 1}`;
    return [{
      id: typeof test.id === "string" && test.id ? test.id : name,
      name,
      passed,
      mode: "exact",
      expected: display(expected),
      actual: display(actual),
      stderr: failure,
      exitCode: passed ? 0 : 1,
      diff: [],
      reason: passed ? "ok" : timedOut ? "timeout" : failure ? "stderr" : "output",
    }];
  });
}

function directGoals(root: UnknownRecord): GoalStatus[] {
  const values = array(root.goals ?? root.goalResults);
  const mapped: GoalStatus[] = values.flatMap((value) => {
    const item = record(value);
    if (!item) return [];
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    if (!id) return [];
    const done = [item.done, item.passed, item.ok].find((candidate) => typeof candidate === "boolean");
    return [{
      id,
      text: typeof item.text === "string" ? item.text : id,
      hint: typeof item.hint === "string" ? item.hint : undefined,
      hidden: item.hidden === true,
      done: done === true,
    }];
  });
  const byId = new Map(mapped.map((goal) => [goal.id, goal]));
  const goalRecord = record(root.goals);
  if (goalRecord) {
    for (const [id, value] of Object.entries(goalRecord)) {
      if (typeof value !== "boolean" || byId.has(id)) continue;
      byId.set(id, { id, text: id, done: value });
    }
  }
  return [...byId.values()];
}

function adaptGoals(root: UnknownRecord, tests: TestResult[], source: string, run: RunResponse | null, goals: Goal[]): GoalStatus[] {
  const evaluated = evaluateGoals(goals, { source, lastRun: run, files: {}, testResults: tests });
  const byId = new Map(evaluated.map((goal) => [goal.id, goal]));
  for (const goal of directGoals(root)) {
    const previous = byId.get(goal.id);
    byId.set(goal.id, previous ? { ...previous, ...goal, text: goal.text || previous.text } : goal);
  }
  return [...byId.values()];
}

function judgeScore(root: UnknownRecord, passed: boolean, tests: TestResult[]): number {
  const explicit = finiteNumber(root.score);
  if (explicit !== null) return Math.max(0, Math.min(100, explicit));
  if (tests.length === 0) return passed ? 100 : 0;
  return Math.round(tests.filter((test) => test.passed).length / tests.length * 100);
}

/** Pure adapter from the package's structured script verdict to workbench UI models. */
export function adaptScriptJudgeResult(
  result: unknown,
  context: { source: string; goals?: Goal[]; run?: RunResponse | null } = { source: "" },
): ScriptWorkbenchViewModel {
  const root = normalizedRoot(result);
  const execution = adaptScriptRunResult(result);
  const tests = adaptTests(root);
  const explicitPassed = [root.passed, root.ok, root.success].find((value) => typeof value === "boolean");
  const passed = typeof explicitPassed === "boolean"
    ? explicitPassed
    : tests.length > 0 && tests.every((test) => test.passed);
  const firstFailure = tests.find((test) => !test.passed) ?? null;
  const verdict: JudgeResult = {
    passed,
    score: judgeScore(root, passed, tests),
    results: tests,
    firstFailure,
  };
  const attempt = record(root.attempt);
  const details = Object.fromEntries([
    "initHash", "scriptHash", "steps", "page", "uncovered", "listeners", "value", "error", "failures", "ledgers",
  ].flatMap((key) => {
    const value = root[key] ?? attempt?.[key];
    return value === undefined ? [] : [[key, value]];
  }));
  return {
    diagnostics: adaptScriptDiagnostics(result),
    run: context.run ?? execution.run,
    verdict,
    goals: adaptGoals(root, tests, context.source, context.run ?? execution.run, context.goals ?? []),
    state: execution.state,
    effects: execution.effects,
    details,
  };
}

export function createScriptAttemptState(challengeId: string | null = null): ScriptAttemptState {
  return { challengeId, passNotified: false };
}

/**
 * A failed attempt can never notify. A successful attempt notifies once per challenge,
 * even if the learner submits the same (or another failing) script again.
 */
export function applyScriptJudgeAttempt(
  state: ScriptAttemptState,
  model: ScriptWorkbenchViewModel,
  payload: { challengeId: string; code: string },
): ScriptAttemptTransition {
  const current = state.challengeId === payload.challengeId
    ? state
    : createScriptAttemptState(payload.challengeId);
  if (!model.verdict?.passed || current.passNotified) {
    return { state: current, onPass: null };
  }
  return {
    state: { challengeId: payload.challengeId, passNotified: true },
    onPass: {
      score: model.verdict.score,
      code: payload.code,
      files: {},
      effects: model.effects,
      state: model.state,
    },
  };
}
