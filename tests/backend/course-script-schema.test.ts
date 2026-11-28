import { describe, expect, it } from "vitest";
import { validatePack, type CoursePack } from "../../src/lib/course";

function packWithJudge(judge: unknown, challenge: Record<string, unknown> = {}): CoursePack {
  return {
    "course.json": JSON.stringify({
      id: "script-course", slug: "script-course", title: "脚本课程",
      langs: ["javascript"], entry: "start.txt",
    }),
    "start.txt": "code:script_move;end;",
    "challenges/script_move.json": JSON.stringify({
      id: "script_move", title: "移动", description: "向上移动", lang: "javascript", mode: "code",
      template: "export function move() { game.player.move(\"up\", 4); }",
      judge: "j_script_move", goals: [], requireAllGoals: false,
      ...challenge,
    }),
    "judges/j_script_move.json": JSON.stringify(judge),
  };
}

const scriptJudge = {
  id: "j_script_move", kind: "script", init: { seed: 7, player: { gold: 10 } },
  cases: [{
    id: "move4", name: "向上移动四步", call: { fn: "move" },
    expect: { "effect:player.moveRoutes:args.0.0.up": 4, "player.gold": 10 },
  }],
};

describe("RPGJS script judge 课程 schema", () => {
  it("保留旧 OI judge，缺省 kind 归一为 oi", () => {
    const pack = packWithJudge({
      id: "j_script_move",
      cases: [{ id: "t1", name: "样例", stdin: "", expected: "ok\n", mode: "eol" }],
    });
    expect(validatePack(pack).judges[0]).toMatchObject({ kind: "oi" });
  });

  it("接受 script judge 的 init、call 与部分状态/effect 断言", () => {
    const validated = validatePack(packWithJudge(scriptJudge));
    expect(validated.judges[0]).toEqual(scriptJudge);
  });

  it("接受 fire/emit、确定性队列、catalog 与解释器预算", () => {
    const judge = {
      ...scriptJudge,
      catalog: { item: ["potion"] }, requiredExports: ["move"],
      limits: { steps: 1000, iterations: 100, maxString: 2000, maxList: 100, depth: 10 },
      cases: [
        { id: "fire", name: "信号", fire: "quests.start", dice: [0.25], expect: { effectsInclude: ["gold"] } },
        { id: "emit", name: "过滤信号", emit: { signal: "quests.start", payload: { ok: true } }, choices: [0], expect: { returns: null } },
      ],
    };
    expect(validatePack(packWithJudge(judge)).judges[0]).toEqual(judge);
  });

  it("拒绝空 expect、缺少运行入口和 OI 字段混用", () => {
    for (const testCase of [
      { id: "t", name: "空期望", call: { fn: "move" }, expect: {} },
      { id: "t", name: "无入口", expect: { "player.gold": 10 } },
      { id: "t", name: "多入口", call: { fn: "move" }, fire: "quests.start", expect: { "player.gold": 10 } },
      { id: "t", name: "混用 OI", call: { fn: "move" }, stdin: "", expect: { "player.gold": 10 } },
    ]) {
      expect(() => validatePack(packWithJudge({ ...scriptJudge, cases: [testCase] })))
        .toThrow(/校验失败/);
    }
  });

  it("拒绝非 JavaScript/非 code 挑战引用 script judge", () => {
    expect(() => validatePack(packWithJudge(scriptJudge, { lang: "python" })))
      .toThrow(/lang=javascript、mode=code/);
    expect(() => validatePack(packWithJudge(scriptJudge, { mode: "term" })))
      .toThrow(/lang=javascript、mode=code/);
  });

  it("拒绝空用例、重复 judge id 和未知 kind", () => {
    expect(() => validatePack(packWithJudge({ ...scriptJudge, cases: [] }))).toThrow(/校验失败/);
    expect(() => validatePack(packWithJudge({ ...scriptJudge, kind: "unknown" }))).toThrow(/校验失败/);

    const pack = packWithJudge(scriptJudge);
    pack["judges/duplicate.json"] = JSON.stringify(scriptJudge);
    expect(() => validatePack(pack)).toThrow(/判题 id 重复/);
  });
});
