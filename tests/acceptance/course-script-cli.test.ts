import { afterEach, describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{
  mkdtempSync(prefix: string): string;
  mkdirSync(path: string): void;
  writeFileSync(path: string, content: string): void;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}>("node:fs");
const { execPath } = builtin<{ execPath: string }>("node:process");
const { spawnSync } = builtin<{
  spawnSync(command: string, args: string[], options: { encoding: string; timeout: number }): {
    status: number | null; stdout: string; stderr: string;
  };
}>("node:child_process");
const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(expectation: Record<string, unknown>) {
  const dir = fs.mkdtempSync("/tmp/opencode/cq-script-cli-");
  tempDirs.push(dir);
  fs.mkdirSync(`${dir}/challenges`);
  fs.mkdirSync(`${dir}/judges`);
  fs.writeFileSync(`${dir}/course.json`, JSON.stringify({
    id: "script-cli", slug: "script-cli", title: "脚本 CLI", langs: ["javascript"], entry: "start.txt",
  }));
  fs.writeFileSync(`${dir}/start.txt`, "code:script_move;end;");
  fs.writeFileSync(`${dir}/challenges/script_move.json`, JSON.stringify({
    id: "script_move", title: "移动", lang: "javascript", mode: "code", judge: "j_script_move",
  }));
  fs.writeFileSync(`${dir}/judges/j_script_move.json`, JSON.stringify({
    id: "j_script_move", kind: "script", init: { seed: 7 },
    cases: [{ id: "move4", name: "向上移动", call: { fn: "move" }, expect: expectation }],
  }));
  return dir;
}

function validate(dir: string) {
  return spawnSync(execPath, ["scripts/validate-course.mjs", dir], {
    encoding: "utf8", timeout: 10_000,
  });
}

describe("script judge CLI 校验", () => {
  it("接受部分状态与 effect 参数断言", () => {
    const result = validate(fixture({ "effect:player.moveRoutes:args.0.0.up": 4, "player.gold": 10 }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("校验通过");
  });

  it("拒绝空 expect", () => {
    const result = validate(fixture({}));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expect 必须是非空对象");
  });
});
