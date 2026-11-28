import { describe, expect, it } from "vitest";
import type { Goal } from "../../packages/judge/src/types";
import {
  adaptScriptDiagnostics,
  adaptScriptJudgeResult,
  adaptScriptRunResult,
  applyScriptJudgeAttempt,
  createScriptAttemptState,
} from "../../apps/web/src/script-workbench";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const goals: Goal[] = [
  { id: "uses-loop", text: "Use a loop", check: { kind: "source-regex", pattern: "for\\s*\\(" } },
  { id: "move-case", text: "Move test passes", check: { kind: "testcase", id: "move" } },
];

const verdict = {
  passed: false,
  score: 50,
  diagnostics: [
    { line: 0, message: "Unknown course API", severity: "error" },
    { line: 4, message: "Listener may run every tick", severity: "warning" },
  ],
  results: [
    {
      id: "move",
      name: "Move four tiles",
      pass: true,
      result: { ok: true, state: { player: { gold: 10 } }, effects: [] },
    },
    {
      id: "gold",
      name: "Spend five gold",
      pass: false,
      failures: ["player.gold=10 expected 5"],
      result: { ok: true, state: { player: { gold: 10 } }, effects: [] },
    },
  ],
  goals: [{ id: "uses-loop", text: "Use a loop", done: true }],
  effects: [{ name: "player.moveRoutes", params: [[{ up: 4 }]] }],
  state: { player: { gold: 10 } },
  initHash: "init-1",
  scriptHash: "script-1",
};

describe("RPGJS 工作台纯适配", () => {
  it("编译诊断保留警告并把整脚本 line 0 规范为 Monaco 首行", () => {
    expect(adaptScriptDiagnostics(verdict)).toEqual([
      { line: 1, message: "Unknown course API", severity: "error" },
      { line: 4, message: "Listener may run every tick", severity: "warning" },
    ]);
    expect(adaptScriptDiagnostics({
      ok: true,
      diagnostics: [],
      warnings: [{ line: 7, message: "Listener may run every tick" }],
    })).toEqual([{ line: 7, message: "Listener may run every tick", severity: "warning" }]);
  });

  it("运行结果映射为 stdout/stderr/exitCode，并保留 effects 与部分状态", () => {
    const result = adaptScriptRunResult({
      ok: false,
      error: "bad way: diagonal",
      effects: [{ name: "player.moveRoutes", params: [[{ diagonal: 2 }]] }],
      state: { player: { gold: 5 } },
    });
    expect(result.run.exitCode).toBe(1);
    expect(result.run.stderr).toBe("bad way: diagonal");
    expect(result.run.stdout).toContain('"gold": 5');
    expect(result.effects).toEqual([{ name: "player.moveRoutes", params: [[{ diagonal: 2 }]] }]);
    expect(result.state).toEqual({ player: { gold: 5 } });
  });

  it("结构化判题结果适配为现有判题/目标 UI 模型", () => {
    const model = adaptScriptJudgeResult(verdict, {
      source: "for (let i = 0; i < 4; i++) { game.player.move('up', 1); }",
      goals,
    });
    expect(model.verdict).toMatchObject({ passed: false, score: 50 });
    expect(model.verdict?.results.map((test) => [test.id, test.passed, test.reason])).toEqual([
      ["move", true, "ok"],
      ["gold", false, "stderr"],
    ]);
    expect(model.verdict?.firstFailure?.id).toBe("gold");
    expect(model.goals).toEqual([
      { id: "uses-loop", text: "Use a loop", hint: undefined, hidden: false, done: true },
      { id: "move-case", text: "Move test passes", hint: undefined, hidden: undefined, done: true },
    ]);
    expect(model.effects).toEqual(verdict.effects);
    expect(model.state).toEqual(verdict.state);
    expect(model.details).toMatchObject({ initHash: "init-1", scriptHash: "script-1" });
  });

  it("兼容对方 Worker 报告的 cases/ledgers 结构", () => {
    const effect = { name: "player.moveRoutes", params: [[{ up: 4 }]] };
    const ledger = {
      initHash: "init-1",
      scriptHash: "script-1",
      effects: [effect],
      partialState: { "player.gold": 5 },
      verdict: { passed: true, failures: [] },
    };
    const report = {
      ok: true,
      passed: true,
      score: 100,
      results: [{
        id: "move",
        name: "Move four tiles",
        weight: 1,
        passed: true,
        failures: [],
        result: { ok: true, effects: [effect], state: { player: { gold: 5 } } },
        ledger,
      }],
      ledgers: [ledger],
      uncovered: {},
    };
    const model = adaptScriptJudgeResult(report, { source: "", goals });
    expect(model.verdict).toMatchObject({ passed: true, score: 100 });
    expect(model.effects).toEqual([effect]);
    expect(model.details.ledgers).toEqual([ledger]);
    expect(adaptScriptRunResult(report).run).toMatchObject({ exitCode: 0, stderr: "" });
  });

  it("失败 attempt 不通知；通过只通知一次，失败重提也不会再次通知", () => {
    const failed = adaptScriptJudgeResult(verdict, { source: "", goals });
    const passed = adaptScriptJudgeResult({ ...verdict, passed: true, score: 100 }, { source: "", goals });
    const payload = { challengeId: "rpgjs-1", code: "game.player.move('up', 4);" };

    const afterFailure = applyScriptJudgeAttempt(createScriptAttemptState(), failed, payload);
    expect(afterFailure.onPass).toBeNull();
    expect(afterFailure.state.passNotified).toBe(false);

    const afterPass = applyScriptJudgeAttempt(afterFailure.state, passed, payload);
    expect(afterPass.onPass).toMatchObject({ score: 100, code: payload.code, files: {} });
    expect(afterPass.state.passNotified).toBe(true);

    expect(applyScriptJudgeAttempt(afterPass.state, passed, payload).onPass).toBeNull();
    expect(applyScriptJudgeAttempt(afterPass.state, failed, payload).onPass).toBeNull();

    const nextChallenge = applyScriptJudgeAttempt(afterPass.state, passed, {
      ...payload,
      challengeId: "rpgjs-2",
    });
    expect(nextChallenge.onPass).toMatchObject({ score: 100, code: payload.code });
  });
});

describe("RPGJS 工作台源码守卫", () => {
  it("CodeEditor 的 API 声明随 prop 更新并在清理时 dispose", () => {
    const source = read("apps/web/src/components/CodeEditor.tsx");
    expect(source).toContain("apiDeclaration?: string");
    expect(source).toContain("javascriptDefaults.addExtraLib");
    expect(source).toContain("return () => declaration.dispose();");
    expect(source).toContain("[apiDeclaration, apiDeclarationPath]");
    expect(source).toContain("useId()");
  });

  it("ScriptWorkbench 只通过 Worker client 检查、模拟与判题", () => {
    const source = read("apps/web/src/components/ScriptWorkbench.tsx");
    expect(source).toContain('from "@codequest/rpgjs-script/client"');
    expect(source).toContain('from "@codequest/rpgjs-script/editor"');
    expect(source).toContain("runScript(workerRequest(code, [])");
    expect(source).toContain("runScript(workerRequest(code, [{");
    expect(source).toContain("runScript(workerRequest(code, tests)");
    expect(source).toContain('language="javascript"');
    expect(source).toContain("apiDeclaration={apiDeclarationText}");
    expect(source).toContain("<JudgePanel");
    expect(source).toContain("<GoalPanel");
    expect(source).toContain("applyScriptJudgeAttempt");
    expect(source).toContain("!goalsSatisfied");
    expect(source).not.toMatch(/import\s+(?!type\b)[^;]*from\s+["']@codequest\/rpgjs-script["']/);
    expect(source).not.toMatch(/from\s+["']@rpgjs\/script(?:\/|\?)/);
    expect(source).not.toMatch(/(?<!\.)\b(?:checkScript|judgeScript|simulate|runTests)\s*\(/);
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
  });

  it("Stage 按 judge.kind 选择 ScriptWorkbench，旧 OI 仍进入 Workbench", () => {
    const source = read("apps/web/src/components/Stage.tsx");
    expect(source).toContain('active.judge?.kind === "script"');
    expect(source).toContain("<ScriptWorkbench");
    expect(source).toContain("<Workbench");
    expect(source).toContain("scriptRunSpec(active.judge.cases[0], active.judge)");
  });
});
