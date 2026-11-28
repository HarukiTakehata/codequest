import {
  apiInfo,
  compileProgram,
  CompileError,
  CompileErrors,
  conditionFailure,
  whereFailure,
  type AstNode,
  type Limits,
  type Program,
} from "@rpgjs/script/core";
import { parseScript } from "@rpgjs/script/parse";
import {
  SharedStore,
  SimWorld,
  scriptWarnings,
  type ModuleSignals,
  type SimulatedWorld,
  type WorldInit,
} from "@rpgjs/script/testing";
import {
  COURSE_API_DESCRIPTION,
  COURSE_API_IMPL,
  courseGlobalNames,
  hostFromCourseApi,
  type CourseApiDescription,
  type CourseMemberDesc,
} from "./api";
import { judgeExpectations, projectPartialState } from "./expectations";
import { deterministicHash, hashScript } from "./hash";
import type {
  AttemptLedger,
  CheckScriptOptions,
  JudgeScriptInput,
  ScriptCaseResult,
  ScriptCheckResult,
  ScriptDiagnostic,
  ScriptJudgeCase,
  ScriptJudgeReport,
  ScriptRunSpec,
  ScriptSimulationResult,
  ScriptVerdict,
  SimulateScriptInput,
} from "./types";

const DEFAULT_LIMITS: Limits = { steps: 20_000, iterations: 100 };

function descriptionWith(signals?: ModuleSignals): CourseApiDescription {
  if (!signals) return COURSE_API_DESCRIPTION;
  return {
    ...COURSE_API_DESCRIPTION,
    signals: { ...COURSE_API_DESCRIPTION.signals, ...signals },
  };
}

function strip(message: string): string {
  return message.replace(/^line \S+: /, "");
}

function lineOf(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const loc = (error as { loc?: { line?: unknown } }).loc;
  return typeof loc?.line === "number" ? loc.line : 0;
}

function emptyCheck(): Omit<ScriptCheckResult, "ok" | "diagnostics"> {
  return {
    warnings: [],
    exports: [],
    handlers: [],
    listeners: [],
    events: [],
    refs: [],
    permissions: [],
    shared: [],
  };
}

interface StaticChain {
  root: string;
  members: string[];
}

function staticChain(node: unknown): StaticChain | null {
  if (!node || typeof node !== "object") return null;
  const value = node as Record<string, unknown>;
  if (value.type === "Identifier" && typeof value.name === "string") {
    return { root: value.name, members: [] };
  }
  if (
    value.type === "MemberExpression" &&
    value.computed !== true &&
    value.property &&
    typeof value.property === "object" &&
    (value.property as Record<string, unknown>).type === "Identifier"
  ) {
    const parent = staticChain(value.object);
    const property = (value.property as Record<string, unknown>).name;
    if (parent && typeof property === "string") {
      return { root: parent.root, members: [...parent.members, property] };
    }
  }
  return null;
}

function walkAst(node: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  const value = node as Record<string, unknown>;
  if (typeof value.type === "string") visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walkAst(child, visit);
  }
}

/**
 * RPGJS 5.3.0 validates members only when the receiver is a bare identifier.
 * Add static checks for our `game.player.<method>` chain without changing the
 * executable AST or exposing the internal handle as a global.
 */
function validateNestedMembers(ast: AstNode, description: CourseApiDescription): void {
  const errors: CompileError[] = [];
  walkAst(ast, (node) => {
    if (node.type !== "MemberExpression") return;
    const chain = staticChain(node);
    if (!chain) return;
    let handle = description.handles[chain.root];
    if (!handle || handle.nested) return;

    for (let index = 0; index < chain.members.length; index++) {
      const memberName = chain.members[index]!;
      const member: CourseMemberDesc | undefined = handle.members?.[memberName];
      if (member) {
        if (!member.handle) return;
        const target = description.handles[member.handle];
        if (!target?.nested) {
          errors.push(new CompileError(
            `"${chain.root}.${memberName}" references an invalid nested handle`,
            node as AstNode,
          ));
          return;
        }
        handle = target;
        continue;
      }
      if (handle.methods?.[memberName]) return;
      if (handle.dynamic) return;
      const available = [
        ...Object.keys(handle.members ?? {}),
        ...Object.keys(handle.methods ?? {}),
      ];
      errors.push(new CompileError(
        `"${[chain.root, ...chain.members.slice(0, index + 1)].join(".")}" does not exist. Available: ${available.join(", ") || "none"}`,
        node as AstNode,
      ));
      return;
    }
  });
  if (errors.length) {
    const unique = [...new Map(errors.map((error) => [`${error.line}:${error.message}`, error])).values()];
    throw new CompileErrors(unique);
  }
}

/** Parse and compile against the single course description. This never runs user code. */
export function checkScript(source: string, options: CheckScriptOptions = {}): ScriptCheckResult {
  let ast: AstNode;
  try {
    ast = parseScript(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostics: [{ line: lineOf(error), message: `syntax error: ${strip(message)}` }],
      ...emptyCheck(),
    };
  }

  try {
    const description = descriptionWith(options.signals);
    validateNestedMembers(ast, description);
    const program = compileProgram(
      ast,
      courseGlobalNames(description),
      apiInfo(description, options.catalog, { checkArguments: true }),
    );
    const missing = (options.requiredExports ?? []).filter((name) => !program.exported.has(name));
    if (missing.length) {
      return {
        ok: false,
        diagnostics: missing.map((name) => ({
          line: 0,
          message: `missing exported function "${name}": the request requires it, write export function ${name}(...) { ... }`,
        })),
        ...emptyCheck(),
      };
    }
    return {
      ok: true,
      diagnostics: [],
      warnings: scriptWarnings(ast),
      program,
      exports: [...program.exported],
      handlers: program.handlers.map((handler) => handler.event),
      listeners: program.handlers.map((handler) => ({ signal: handler.event, filter: handler.filter })),
      events: program.events.map((event) => ({ name: event.name, pages: event.pages.length })),
      refs: program.refs,
      permissions: [...program.permissions].sort(),
      shared: program.shared,
    };
  } catch (error) {
    const errors = error instanceof CompileErrors
      ? error.errors
      : error instanceof CompileError
        ? [error]
        : null;
    if (!errors) throw error;
    return {
      ok: false,
      diagnostics: errors.map((item) => ({ line: item.line, message: strip(item.message) })),
      ...emptyCheck(),
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Clone plain world data so mutable arrays/stores cannot leak between cases. */
function cloneData<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value as object);
  if (prior !== undefined) return prior as T;
  if (value instanceof SharedStore) {
    const store = new SharedStore();
    seen.set(value, store);
    store.values = cloneData(value.values, seen);
    store.decl = cloneData(value.decl, seen);
    return store as T;
  }
  if (Array.isArray(value)) {
    const array: unknown[] = [];
    seen.set(value, array);
    for (const item of value) array.push(cloneData(item, seen));
    return array as T;
  }
  if (!isPlainRecord(value)) return value;
  const record: Record<string, unknown> = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
  seen.set(value as object, record);
  for (const [key, item] of Object.entries(value)) record[key] = cloneData(item, seen);
  return record as T;
}

const MERGEABLE_WORLD_KEYS = new Set([
  "player",
  "sheet",
  "room",
  "event",
  "vars",
  "state",
  "hook",
  "engine",
  "sharedValues",
]);

function mergeWorldInit(base: SimulatedWorld | undefined, override: SimulatedWorld | undefined): SimulatedWorld {
  const merged = cloneData(base ?? {});
  if (!override) return merged;
  for (const [key, value] of Object.entries(override)) {
    const current = (merged as Record<string, unknown>)[key];
    (merged as Record<string, unknown>)[key] = MERGEABLE_WORLD_KEYS.has(key) && isPlainRecord(current) && isPlainRecord(value)
      ? { ...current, ...cloneData(value) }
      : cloneData(value);
  }
  return merged;
}

function createWorld(init: SimulatedWorld, program: Program): SimWorld {
  const copy = cloneData(init);
  let presets = copy.sharedValues;
  if (copy.shared !== undefined && !(copy.shared instanceof SharedStore)) {
    presets = {
      ...presets ?? {},
      ...copy.shared && typeof copy.shared === "object" ? copy.shared : {},
    };
  }
  const worldInit: WorldInit = {
    ...copy,
    shared: copy.shared instanceof SharedStore ? copy.shared : undefined,
  };
  const world = new SimWorld(worldInit);
  world.shared.declare(program.shared);
  Object.assign(world.shared.values, presets ?? {});
  return world;
}

function freezePayload<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) freezePayload(child, seen);
  return Object.freeze(value);
}

async function executeProgram(
  program: Program,
  description: CourseApiDescription,
  spec: ScriptRunSpec,
  cover?: Set<number>,
): Promise<ScriptSimulationResult> {
  const world = createWorld(spec.world ?? {}, program);
  const host = hostFromCourseApi(description, COURSE_API_IMPL, world);
  const limits = spec.limits ?? DEFAULT_LIMITS;
  try {
    if (spec.call) {
      const { value, steps } = await program.call(spec.call.fn, spec.call.args ?? [], host, limits, cover);
      return { ok: true, value, steps, effects: world.effects, state: world.snapshot() };
    }
    if (spec.event !== undefined) {
      const { page, steps } = await program.runEvent(spec.event, host, limits, cover);
      return { ok: true, page, steps, effects: world.effects, state: world.snapshot() };
    }
    if (spec.fire) {
      await program.fire(spec.fire, host, limits, cover);
      return { ok: true, effects: world.effects, state: world.snapshot() };
    }
    if (spec.emit) {
      const payload = freezePayload(cloneData(spec.emit.payload ?? {}));
      world.hook = payload && typeof payload === "object"
        ? payload as Record<string, unknown>
        : {};
      const listeners = [];
      for (const handler of program.handlers.filter((candidate) => candidate.event === spec.emit!.signal)) {
        const report: {
          script: string;
          matched: boolean;
          ran: boolean;
          why?: string;
          error?: string;
        } = { script: "script", matched: false, ran: false };
        listeners.push(report);
        const where = whereFailure(payload, handler.filter?.where);
        if (where) {
          report.why = where;
          continue;
        }
        const when = conditionFailure(handler.filter?.when, world.player);
        if (when) {
          report.why = when;
          continue;
        }
        report.matched = true;
        try {
          await program.run(handler, [payload], host, limits, cover);
          report.ran = true;
        } catch (error) {
          report.error = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        ok: true,
        listeners,
        effects: world.effects,
        state: world.snapshot(),
      };
    }
    throw new Error("a script run needs one of call, event, fire or emit");
  } catch (error) {
    const name = error instanceof Error ? error.constructor.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `${name}: ${message}`,
      effects: world.effects,
      state: world.snapshot(),
    };
  }
}

/** Run one scenario in a newly-created SimWorld. */
export async function simulate(input: SimulateScriptInput): Promise<ScriptSimulationResult> {
  const checked = checkScript(input.source, {
    catalog: input.catalog,
    requiredExports: input.requiredExports,
    signals: input.signals,
  });
  if (!checked.ok || !checked.program) {
    return { ok: false, diagnostics: checked.diagnostics, effects: [] };
  }
  const cover = new Set<number>();
  const result = await executeProgram(checked.program, descriptionWith(input.signals), input, cover);
  return { ...result, uncovered: checked.program.uncovered(cover) };
}

export function createAttemptLedger(
  init: SimulatedWorld,
  source: string,
  result: ScriptSimulationResult,
  verdict: ScriptVerdict,
  expectations: Record<string, unknown>,
): AttemptLedger {
  return {
    initHash: deterministicHash(init),
    scriptHash: hashScript(source),
    effects: cloneData(result.effects),
    partialState: cloneData(projectPartialState(result.state, expectations)),
    verdict: { passed: verdict.passed, failures: [...verdict.failures] },
  };
}

function failedCompilationReport(diagnostics: ScriptDiagnostic[]): ScriptJudgeReport {
  return {
    ok: false,
    passed: false,
    score: 0,
    diagnostics,
    results: [],
    ledgers: [],
    uncovered: {},
  };
}

export async function judgeScript(input: JudgeScriptInput): Promise<ScriptJudgeReport>;
export async function judgeScript(
  source: string,
  cases: ScriptJudgeCase[],
  options?: Omit<JudgeScriptInput, "source" | "cases">,
): Promise<ScriptJudgeReport>;
export async function judgeScript(
  inputOrSource: JudgeScriptInput | string,
  cases?: ScriptJudgeCase[],
  options: Omit<JudgeScriptInput, "source" | "cases"> = {},
): Promise<ScriptJudgeReport> {
  const input: JudgeScriptInput = typeof inputOrSource === "string"
    ? { ...options, source: inputOrSource, cases: cases ?? [] }
    : inputOrSource;

  const signals: ModuleSignals = { ...input.signals };
  for (const test of input.cases) Object.assign(signals, test.signals);
  const checked = checkScript(input.source, {
    catalog: input.catalog,
    requiredExports: input.requiredExports,
    signals,
  });
  if (!checked.ok || !checked.program) return failedCompilationReport(checked.diagnostics);

  const cover = new Set<number>();
  const results: ScriptCaseResult[] = [];
  const scriptHash = hashScript(input.source);
  for (const test of input.cases) {
    const init = mergeWorldInit(input.init, test.world);
    const world: SimulatedWorld = { ...init };
    if (test.dice !== undefined) world.dice = test.dice;
    if (test.choices !== undefined) world.choices = test.choices;
    const spec: ScriptRunSpec = {
      call: test.call,
      event: test.event,
      fire: test.fire,
      emit: test.emit,
      world,
      limits: test.limits ?? input.limits,
      signals: test.signals,
    };
    const description = descriptionWith({ ...input.signals, ...test.signals });
    const result = await executeProgram(checked.program, description, spec, cover);
    const failures = judgeExpectations(result, test.expect);
    const verdict: ScriptVerdict = { passed: failures.length === 0, failures };
    const weight = typeof test.weight === "number" && Number.isFinite(test.weight) && test.weight > 0
      ? test.weight
      : 1;
    const ledger = createAttemptLedger(world, input.source, result, verdict, test.expect);
    // scriptHash is computed once above; keep the ledger helper as the single
    // constructor so standalone attempt records have exactly the same shape.
    ledger.scriptHash = scriptHash;
    results.push({
      id: test.id ?? test.name,
      name: test.name,
      weight,
      passed: verdict.passed,
      failures,
      result,
      ledger,
    });
  }

  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0) || 1;
  const earned = results.reduce((sum, result) => sum + (result.passed ? result.weight : 0), 0);
  return {
    ok: true,
    passed: results.length > 0 && results.every((result) => result.passed),
    score: Math.round(earned / totalWeight * 100),
    results,
    ledgers: results.map((result) => result.ledger),
    uncovered: checked.program.uncovered(cover),
  };
}
