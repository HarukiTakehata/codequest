import type { DiffLine, DiffMode } from "./types";

/** 归一化后逐行比较；regex-line 的 expected 每一行都是正则。 */
function normalize(mode: DiffMode, text: string): string[] {
  let value = text.replace(/\r\n?/g, "\n");
  if (mode === "eol" || mode === "ws") {
    value = value
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n+$/g, "");
  }
  if (mode === "ws") {
    value = value.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  }
  if (value === "") return [];
  return value.split("\n");
}

function numbers(line: string): number[] {
  const matches = line.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  return matches ? matches.map(Number) : [];
}

function numericEqual(expected: string, actual: string, tolerance: number): boolean {
  const a = numbers(expected);
  const b = numbers(actual);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const scale = Math.max(1, Math.abs(a[i]!), Math.abs(b[i]!));
    if (Math.abs(a[i]! - b[i]!) > tolerance * scale) return false;
  }
  // 非数字骨架也必须一致（例如 "x = 1" 与 "y = 1" 不应通过）。
  return expected.replace(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, "#") ===
    actual.replace(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, "#");
}

const END_MARKER = "␃"; // 仅在 exact 模式标出缺失的末行换行

export function compareOutput(
  expected: string,
  actual: string,
  mode: DiffMode = "eol",
  tolerance = 1e-6,
): DiffLine[] {
  if (mode === "exact") {
    if (expected === actual) return [];
    const want = expected.replace(/\r\n?/g, "\n").split("\n");
    const got = actual.replace(/\r\n?/g, "\n").split("\n");
    const diffs: DiffLine[] = [];
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      const e = want[i] ?? END_MARKER;
      const a = got[i] ?? END_MARKER;
      if (e !== a) diffs.push({ line: i + 1, expected: e, actual: a });
    }
    return diffs;
  }
  const want = normalize(mode, expected);
  const got = normalize(mode, actual);
  const diffs: DiffLine[] = [];
  const length = Math.max(want.length, got.length);
  for (let i = 0; i < length; i++) {
    const e = want[i] ?? "";
    const a = got[i] ?? "";
    let equal = e === a;
    if (!equal && mode === "regex-line") {
      try {
        equal = new RegExp(e).test(a);
      } catch {
        equal = false;
      }
    }
    if (!equal && mode === "numeric-tol") equal = numericEqual(e, a, tolerance);
    if (!equal) diffs.push({ line: i + 1, expected: e, actual: a });
  }
  return diffs;
}
