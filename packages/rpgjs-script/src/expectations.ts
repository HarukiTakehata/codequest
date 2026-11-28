import type {
  ScriptEffect,
  ScriptExpectations,
  ScriptSimulationResult,
  ScriptState,
} from "./types";

const KNOWN_EXPECTATIONS = new Set([
  "returns",
  "page",
  "error",
  "effects",
  "effectsInclude",
  "effectsExclude",
  "texts",
  "notifications",
]);

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const EFFECT_EXPECTATION = /^effect:([^:]+):(.+)$/;

export interface PathValue {
  found: boolean;
  value?: unknown;
}

export function readDottedPath(root: unknown, path: string): PathValue {
  if (!path || path.split(".").some((part) => !part || UNSAFE_PATH_SEGMENTS.has(part))) {
    return { found: false };
  }
  let current = root;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(part)) return { found: false };
      const index = Number(part);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== "object") return { found: false };
    if (!Object.prototype.hasOwnProperty.call(current, part)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

export function isStateExpectationKey(key: string): boolean {
  return !KNOWN_EXPECTATIONS.has(key) && !EFFECT_EXPECTATION.test(key);
}

function stateValue(state: ScriptState | undefined, path: string): PathValue {
  const read = readDottedPath(state, path);
  // Match RPGJS's useful inventory convention: a missing item has quantity 0.
  if (!read.found && path.startsWith("player.items.")) return { found: true, value: 0 };
  return read;
}

export function projectPartialState(
  state: ScriptState | undefined,
  expectations: ScriptExpectations,
): Record<string, unknown> {
  const partial: Record<string, unknown> = {};
  for (const key of Object.keys(expectations)) {
    if (!isStateExpectationKey(key)) continue;
    const read = stateValue(state, key);
    if (read.found) partial[key] = read.value;
  }
  return partial;
}

function dataEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => dataEqual(value, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(rightRecord, key) && dataEqual(leftRecord[key], rightRecord[key]),
  );
}

function matches(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    ("min" in expected || "max" in expected)
  ) {
    const range = expected as { min?: unknown; max?: unknown };
    if (typeof actual !== "number") return false;
    if (range.min !== undefined && (typeof range.min !== "number" || actual < range.min)) return false;
    if (range.max !== undefined && (typeof range.max !== "number" || actual > range.max)) return false;
    return true;
  }
  return dataEqual(actual, expected);
}

function display(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function effectTexts(effects: ScriptEffect[], name: "showText" | "showNotification"): unknown[] {
  const key = name === "showText" ? "text" : "message";
  return effects.filter((effect) => effect.name === name).flatMap((effect) => {
    if (effect.params === null || typeof effect.params !== "object") return [];
    const params = effect.params as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(params, key) ? [params[key]] : [];
  });
}

function expectedList(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Deterministic assertion engine shared by headless judging and replay. */
export function judgeExpectations(
  result: ScriptSimulationResult,
  expectations: ScriptExpectations,
): string[] {
  const failures: string[] = [];
  const wantsError = Object.prototype.hasOwnProperty.call(expectations, "error");

  if (wantsError) {
    const expectedError = expectations.error;
    if (result.ok) {
      failures.push(`expected the error ${display(expectedError)}, got no error`);
    } else if (expectedError !== true && !String(result.error).includes(String(expectedError))) {
      failures.push(`expected the error ${display(expectedError)}, got ${result.error}`);
    }
    // Like RPGJS runTests, an expected error is the whole assertion for this case.
    return failures;
  }
  if (!result.ok) {
    failures.push(`the script failed: ${result.error ?? JSON.stringify(result.diagnostics)}`);
    return failures;
  }

  const names = result.effects.map((effect) => effect.name);
  for (const [key, expected] of Object.entries(expectations)) {
    if (key === "error") continue;
    if (key === "returns") {
      if (!dataEqual(result.value, expected)) {
        failures.push(`returns=${display(result.value)} expected ${display(expected)}`);
      }
      continue;
    }
    if (key === "page") {
      if (result.page !== expected) failures.push(`page=${display(result.page)} expected ${display(expected)}`);
      continue;
    }
    if (key === "effects") {
      const wanted = expectedList(expected);
      if (!wanted || !dataEqual(names, wanted)) {
        failures.push(`effects=${display(names)} expected ${display(expected)}`);
      }
      continue;
    }
    if (key === "effectsInclude" || key === "effectsExclude") {
      const wanted = expectedList(expected);
      if (!wanted) {
        failures.push(`${key} must be a list of effect names`);
        continue;
      }
      for (const name of wanted) {
        const present = typeof name === "string" && names.includes(name);
        if (key === "effectsInclude" && !present) failures.push(`expected an effect ${display(name)}`);
        if (key === "effectsExclude" && present) failures.push(`unexpected effect ${display(name)}`);
      }
      continue;
    }
    if (key === "texts" || key === "notifications") {
      const effectName = key === "texts" ? "showText" : "showNotification";
      const actual = effectTexts(result.effects, effectName);
      if (!dataEqual(actual, expected)) failures.push(`${key}=${display(actual)} expected ${display(expected)}`);
      continue;
    }

    const effectExpectation = EFFECT_EXPECTATION.exec(key);
    if (effectExpectation) {
      const [, effectName, path] = effectExpectation;
      const effect = result.effects.find((candidate) => candidate.name === effectName);
      if (!effect) {
        failures.push(`missing effect ${display(effectName)}`);
        continue;
      }
      const actual = readDottedPath(effect.params, path);
      if (!actual.found || !matches(actual.value, expected)) {
        failures.push(`${key}=${display(actual.value)} expected ${display(expected)}`);
      }
      continue;
    }

    if (isStateExpectationKey(key)) {
      const actual = stateValue(result.state, key);
      if (!actual.found || !matches(actual.value, expected)) {
        failures.push(`${key}=${display(actual.value)} expected ${display(expected)}`);
      }
      continue;
    }

    failures.push(`unknown expectation ${display(key)}`);
  }

  return failures;
}
