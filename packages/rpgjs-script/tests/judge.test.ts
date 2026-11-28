import { describe, expect, it } from "vitest";
import { checkScript, judgeScript, simulate } from "../src/judge";
import type { JudgeScriptInput, ScriptJudgeCase } from "../src/types";

const MOVE_AND_REWARD = `
export function move() {
  game.player.move("up", 4);
  $player.gold -= 5;
  $player.showText("hello");
  $player.showNotification("done");
  return 7;
}
`;

function oneCase(source = MOVE_AND_REWARD, test: Partial<ScriptJudgeCase> = {}): JudgeScriptInput {
  return {
    source,
    init: { seed: 7, player: { gold: 10 } },
    cases: [{
      id: "move4",
      name: "向上移动四步",
      call: { fn: "move" },
      expect: { "effect:player.moveRoutes:args.0.0.up": 4, "player.gold": 5 },
      ...test,
    }],
  };
}

describe("thin check/simulate/judgeScript wrapper", () => {
  it("checks without executing and simulates a fresh world", async () => {
    const checked = checkScript(MOVE_AND_REWARD, { requiredExports: ["move"] });
    expect(checked.ok).toBe(true);
    expect(checked.exports).toEqual(["move"]);

    const result = await simulate({
      source: MOVE_AND_REWARD,
      call: { fn: "move" },
      world: { player: { gold: 10 } },
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe(7);
    expect(result.state?.player.gold).toBe(5);
  });

  it("judges partial state, ranges, effects, texts, notifications and returns", async () => {
    const report = await judgeScript(oneCase(MOVE_AND_REWARD, {
      expect: {
        "effect:player.moveRoutes:args.0.0.up": 4,
        "player.gold": { min: 4, max: 6 },
        returns: 7,
        effects: ["player.moveRoutes", "gold", "showText", "showNotification"],
        effectsInclude: ["player.moveRoutes", "gold"],
        effectsExclude: ["teleport"],
        texts: ["hello"],
        notifications: ["done"],
      },
    }));
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.results[0]?.failures).toEqual([]);
  });

  it("supports vars, mapVars, state and event partial paths", async () => {
    const source = `
export function values() {
  $player.setVariable("score", 8);
  $map.setVariable("weather", "rain");
  $state.cleared = true;
  return $player.getVariable("score");
}`;
    const report = await judgeScript({
      source,
      init: { events: [{ id: "guard", x: 4, y: 3 }] },
      cases: [{
        name: "partial paths",
        call: { fn: "values" },
        expect: {
          returns: 8,
          "vars.score": 8,
          "mapVars.weather": "rain",
          "state.cleared": true,
          "events.guard.x": 4,
        },
      }],
    });
    expect(report.passed).toBe(true);
  });

  it("asserts expected runtime errors", async () => {
    const report = await judgeScript(oneCase(
      'export function move() { game.player.move("diagonal", 4); }',
      { expect: { error: "bad way: diagonal" } },
    ));
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.results[0]?.result.ok).toBe(false);
  });

  it("supports fire and filtered emit entry points", async () => {
    const source = `
on("player.levelUp", { where: { level: { gte: 4 } } }, () => {
  game.player.move("left", 2);
});`;
    const fired = await judgeScript({
      source,
      cases: [{
        name: "fire",
        fire: "player.levelUp",
        expect: { "effect:player.moveRoutes:args.0.0.left": 2 },
      }],
    });
    expect(fired.passed).toBe(true);

    const emitted = await judgeScript({
      source,
      cases: [{
        name: "emit",
        emit: { signal: "player.levelUp", payload: { level: 4 } },
        expect: { "effect:player.moveRoutes:args.0.0.left": 2 },
      }],
    });
    expect(emitted.passed).toBe(true);
    expect(emitted.results[0]?.result.listeners?.[0]?.ran).toBe(true);

    const filtered = await judgeScript({
      source,
      cases: [{
        name: "filtered emit",
        emit: { signal: "player.levelUp", payload: { level: 3 } },
        expect: { effects: [], effectsExclude: ["player.moveRoutes"] },
      }],
    });
    expect(filtered.passed).toBe(true);
    expect(filtered.results[0]?.result.listeners?.[0]?.matched).toBe(false);
  });

  it("returns compile diagnostics instead of running a misspelled script", async () => {
    const report = await judgeScript(oneCase(
      "export function move() { game.palyer.move('up', 4); }",
    ));
    expect(report.ok).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.results).toEqual([]);
    expect(report.diagnostics?.map((item) => item.message).join(" ")).toContain("game.palyer");
  });
});

describe("world isolation and rollback-by-replay", () => {
  it("creates a fresh SimWorld for every case", async () => {
    const source = "export function spend() { $player.gold -= 5; }";
    const report = await judgeScript({
      source,
      init: { player: { gold: 10 } },
      cases: [
        { name: "first", call: { fn: "spend" }, expect: { "player.gold": 5 } },
        { name: "second", call: { fn: "spend" }, expect: { "player.gold": 5 } },
      ],
    });
    expect(report.passed).toBe(true);
    expect(report.results.map((result) => result.result.state?.player.gold)).toEqual([5, 5]);
    expect(report.results.map((result) => result.result.effects.map((effect) => effect.name))).toEqual([
      ["gold"],
      ["gold"],
    ]);
  });

  it("does not leak SUBTLE_BAD effects or partial state into a fresh attempt", async () => {
    const subtleBad = `
export function move() {
  game.player.move("up", 2);
  $player.gold -= 5;
}`;
    const failed = await judgeScript(oneCase(subtleBad));
    expect(failed.passed).toBe(false);
    expect(failed.results[0]?.failures.join(" ")).toContain("args.0.0.up=2 expected 4");
    expect(failed.results[0]?.result.state?.player.gold).toBe(5);

    const fresh = await judgeScript(oneCase());
    expect(fresh.passed).toBe(true);
    expect(fresh.results[0]?.result.state?.player.gold).toBe(5);
    expect(fresh.results[0]?.result.effects[0]?.params).toEqual({ args: [[{ up: 4 }]] });
  });

  it("merges case world overrides without mutating the shared init", async () => {
    const init = { seed: 7, player: { gold: 10, hp: 20 }, vars: { visits: 1 } };
    const input: JudgeScriptInput = {
      source: "export function move() { $player.gold -= 5; }",
      init,
      cases: [
        {
          name: "override",
          call: { fn: "move" },
          world: { player: { hp: 30 }, vars: { visits: 2 } },
          expect: { "player.gold": 5, "player.hp": 30, "vars.visits": 2 },
        },
        {
          name: "original",
          call: { fn: "move" },
          expect: { "player.gold": 5, "player.hp": 20, "vars.visits": 1 },
        },
      ],
    };
    const report = await judgeScript(input);
    expect(report.passed).toBe(true);
    expect(init).toEqual({ seed: 7, player: { gold: 10, hp: 20 }, vars: { visits: 1 } });
  });
});
