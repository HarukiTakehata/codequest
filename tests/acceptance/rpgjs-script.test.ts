import { describe, expect, it } from "vitest";
import { judgeScript, type JudgeScriptInput } from "../../packages/rpgjs-script/src";
import { validatePack, type CoursePack } from "../../src/lib/course";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const { execPath } = builtin<{ execPath: string }>("node:process");
const { fileURLToPath } = builtin<{ fileURLToPath(url: URL): string }>("node:url");
const { spawnSync } = builtin<{
  spawnSync(command: string, args: string[], options: { encoding: string; timeout: number }): {
    status: number | null; stdout: string; stderr: string;
  };
}>("node:child_process");
const fixtureRoot = new URL("../fixtures/rpgjs-script/", import.meta.url);
const read = (path: string) => fs.readFileSync(new URL(path, fixtureRoot), "utf8");
const judge = JSON.parse(read("judges/j_script_move.json")) as Omit<JudgeScriptInput, "source"> & {
  id: string;
  kind: "script";
};
const reference = read("solutions/reference.rpgjs.txt");

function pack(): CoursePack {
  return {
    "course.json": read("course.json"),
    "start.txt": read("start.txt"),
    "challenges/script_move.json": read("challenges/script_move.json"),
    "judges/j_script_move.json": read("judges/j_script_move.json"),
  };
}

describe("RPGJS 脚本课程可复现验收", () => {
  it("挑战与 script judge 通过服务端 schema 和 CLI 校验", () => {
    expect(validatePack(pack()).judges[0]).toMatchObject({ id: "j_script_move", kind: "script" });
    const cli = spawnSync(execPath, ["scripts/validate-course.mjs", fileURLToPath(fixtureRoot)], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain("校验通过");
  });

  it("参考解通过两个用例，且每个用例都从同一 init 新建世界", async () => {
    const report = await judgeScript({ ...judge, source: reference });
    expect(report).toMatchObject({ ok: true, passed: true, score: 100 });
    expect(report.results.map((result) => result.result.state?.player.gold)).toEqual([5, 5]);
    expect(report.results.map((result) => result.result.effects[0]?.params)).toEqual([
      { args: [[{ up: 4 }]] },
      { args: [[{ up: 4 }]] },
    ]);
    expect(report.ledgers.every((ledger) => ledger.verdict.passed)).toBe(true);
  });

  it("SUBTLE_BAD 已扣 gold 且发出错误移动效果，失败后重放仍得到干净结果", async () => {
    const failed = await judgeScript({ ...judge, source: read("solutions/subtle-bad.rpgjs.txt") });
    expect(failed.passed).toBe(false);
    expect(failed.results[0]?.failures.join(" ")).toContain("args.0.0.up=2 expected 4");
    expect(failed.results[0]?.result.state?.player.gold).toBe(5);
    expect(failed.ledgers[0]?.partialState["player.gold"]).toBe(5);

    const fresh = await judgeScript({ ...judge, source: reference });
    expect(fresh.passed).toBe(true);
    expect(fresh.results.map((result) => result.result.state?.player.gold)).toEqual([5, 5]);
    expect(fresh.results[0]?.result.effects[0]?.params).toEqual({ args: [[{ up: 4 }]] });
  });

  it("非法方向在宿主执行期拒绝，拼错 API 在编译期拒绝", async () => {
    const illegal = await judgeScript({ ...judge, source: read("solutions/illegal-way.rpgjs.txt") });
    expect(illegal.ok).toBe(true);
    expect(illegal.passed).toBe(false);
    expect(illegal.results[0]?.result.error).toContain("bad way: diagonal");

    const typo = await judgeScript({
      ...judge,
      source: 'export function move() { game.palyer.move("up", 4); }',
    });
    expect(typo).toMatchObject({ ok: false, passed: false, score: 0 });
    expect(typo.diagnostics?.map((item) => item.message).join(" ")).toContain("game.palyer");
  });
});
