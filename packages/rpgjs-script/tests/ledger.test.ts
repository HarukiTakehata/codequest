import { describe, expect, it } from "vitest";
import { deterministicHash, hashScript } from "../src/hash";
import { judgeScript } from "../src/judge";

const SOURCE = `
export function move() {
  game.player.move("up", 4);
  $player.gold -= 5;
}`;

function input() {
  return {
    source: SOURCE,
    init: { seed: 7, player: { gold: 10, hp: 20 }, state: { hidden: "not projected" } },
    cases: [{
      id: "move4",
      name: "move",
      call: { fn: "move" },
      expect: { "player.gold": 5, "effect:player.moveRoutes:args.0.0.up": 4 },
    }],
  };
}

describe("AttemptLedger", () => {
  it("hashes canonically and changes with init or source", () => {
    expect(deterministicHash({ b: 2, a: 1 })).toBe(deterministicHash({ a: 1, b: 2 }));
    expect(deterministicHash({ player: { gold: 10 } })).not.toBe(deterministicHash({ player: { gold: 11 } }));
    expect(hashScript(SOURCE)).not.toBe(hashScript(`${SOURCE}\n// changed`));
    expect(hashScript(SOURCE)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
  });

  it("records stable hashes, ordered effects, partial state and verdict", async () => {
    const first = await judgeScript(input());
    const second = await judgeScript(input());
    expect(first).toEqual(second);

    const ledger = first.results[0]!.ledger;
    expect(ledger.initHash).toBe(deterministicHash(input().init));
    expect(ledger.scriptHash).toBe(hashScript(SOURCE));
    expect(ledger.effects).toEqual([
      { name: "player.moveRoutes", params: { args: [[{ up: 4 }]] } },
      { name: "gold", params: { value: 5 } },
    ]);
    expect(ledger.partialState).toEqual({ "player.gold": 5 });
    expect(ledger.partialState).not.toHaveProperty("player.hp");
    expect(ledger.partialState).not.toHaveProperty("state.hidden");
    expect(ledger.verdict).toEqual({ passed: true, failures: [] });
    expect(first.ledgers).toEqual([ledger]);
  });

  it("keeps the failed attempt ledger deterministic without retaining its world", async () => {
    const bad = input();
    bad.cases[0]!.expect["effect:player.moveRoutes:args.0.0.up"] = 5;
    const first = await judgeScript(bad);
    const second = await judgeScript(bad);
    expect(first).toEqual(second);
    expect(first.results[0]?.ledger.verdict.passed).toBe(false);
    expect(first.results[0]?.ledger.verdict.failures.join(" ")).toContain("expected 5");

    const fresh = await judgeScript(input());
    expect(fresh.passed).toBe(true);
    expect(fresh.results[0]?.result.state?.player.gold).toBe(5);
  });
});
