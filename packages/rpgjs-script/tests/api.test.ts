import { describe, expect, it } from "vitest";
import {
  COURSE_API_DECLARATIONS,
  COURSE_API_DESCRIPTION,
  COURSE_API_IMPL,
  MAX_MOVE_TIMES,
  ROUTE_STEPS,
  assertCourseApiParity,
  courseGlobalNames,
  missingCourseImplementations,
  missingNestedImplementations,
} from "../src";
import { missingImplementations } from "@rpgjs/script/core";
import { checkScript, simulate } from "../src/judge";

const moveSource = (way = "up", times = 4) =>
  `export function move() { game.player.move(${JSON.stringify(way)}, ${times}); }`;

describe("course RPGJS API parity and declarations", () => {
  it("covers the flat and internal nested implementations exactly", () => {
    expect(missingImplementations(COURSE_API_DESCRIPTION, COURSE_API_IMPL)).toEqual([]);
    expect(missingNestedImplementations(COURSE_API_DESCRIPTION, COURSE_API_IMPL)).toEqual([]);
    expect(missingCourseImplementations()).toEqual([]);
    expect(() => assertCourseApiParity()).not.toThrow();
  });

  it("exposes game but never the internal gamePlayer global", () => {
    expect(COURSE_API_DESCRIPTION.handles.gamePlayer.nested).toBe(true);
    expect(courseGlobalNames()).toContain("game");
    expect(courseGlobalNames()).not.toContain("gamePlayer");
    expect(checkScript("export function bad() { gamePlayer.move('up', 1); }").ok).toBe(false);
  });

  it("generates Monaco declarations for game.player.move only", () => {
    expect(COURSE_API_DECLARATIONS).toContain("declare const game:");
    expect(COURSE_API_DECLARATIONS).toContain("game.player.move");
    expect(COURSE_API_DECLARATIONS).toContain("readonly player:");
    expect(COURSE_API_DECLARATIONS).toContain("move(way: string, times: number): void");
    expect(COURSE_API_DECLARATIONS).not.toContain("declare const gamePlayer");
  });

  it("detects drift inside the internal nested handle", () => {
    const drifted = {
      ...COURSE_API_IMPL,
      handles: {
        ...COURSE_API_IMPL.handles,
        gamePlayer: { methods: {} },
      },
    };
    expect(missingNestedImplementations(COURSE_API_DESCRIPTION, drifted)).toContain(
      "nested handle gamePlayer.move() is not implemented",
    );
  });

  it("pins the RPGJS 5.3.0 movement whitelist and repeat limit", () => {
    expect(ROUTE_STEPS).toEqual([
      "up", "down", "left", "right", "random",
      "tileUp", "tileDown", "tileLeft", "tileRight", "tileRandom",
      "turnUp", "turnDown", "turnLeft", "turnRight", "turnRandom",
      "towardPlayer", "awayFromPlayer", "tileTowardPlayer", "tileAwayFromPlayer",
      "turnTowardPlayer", "turnAwayFromPlayer",
    ]);
    expect(ROUTE_STEPS).not.toContain("wait");
    expect(MAX_MOVE_TIMES).toBe(100);
  });
});

describe("course API compilation and execution", () => {
  it("compiles the nested facade and records an up-four route effect", async () => {
    expect(checkScript(moveSource()).ok).toBe(true);
    const result = await simulate({ source: moveSource(), call: { fn: "move" } });
    expect(result.ok).toBe(true);
    expect(result.effects).toEqual([{
      name: "player.moveRoutes",
      params: { args: [[{ up: 4 }]] },
    }]);
  });

  it.each([
    ["game.palyer.move('up', 4)", "game.palyer"],
    ["game.player.mvoe('up', 4)", "game.player.mvoe"],
  ])("rejects a misspelled nested member at compile time: %s", (source) => {
    const checked = checkScript(`export function move() { ${source}; }`);
    expect(checked.ok).toBe(false);
    expect(checked.diagnostics.map((item) => item.message).join(" ")).toContain(source.includes("palyer") ? "game.palyer" : "game.player.mvoe");
  });

  it.each([
    ["diagonal", 4, "bad way: diagonal"],
    ["up", 0, "bad times: 0"],
    ["up", 101, "bad times: 101"],
    ["up", 1.5, "bad times: 1.5"],
  ])("rejects illegal move arguments way=%s times=%s", async (way, times, message) => {
    const result = await simulate({ source: moveSource(way, times), call: { fn: "move" } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain(message);
    expect(result.effects).toEqual([]);
  });

  it("rejects missing or extra move arguments", async () => {
    for (const source of [
      'export function move() { game.player.move("up"); }',
      'export function move() { game.player.move("up", 4, true); }',
    ]) {
      const result = await simulate({ source, call: { fn: "move" } });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("takes 2 arguments");
    }
  });

  it("accepts boundary repeat counts", async () => {
    for (const times of [1, MAX_MOVE_TIMES]) {
      const result = await simulate({ source: moveSource("up", times), call: { fn: "move" } });
      expect(result.ok).toBe(true);
      expect(result.effects[0]?.params).toEqual({ args: [[{ up: times }]] });
    }
  });

  it("does not provide eval or arbitrary JavaScript execution", () => {
    const checked = checkScript('export function bad() { eval("game.player.move(\'up\', 4)"); }');
    expect(checked.ok).toBe(false);
    expect(checked.diagnostics.map((item) => item.message).join(" ")).toContain('unknown name "eval"');
  });
});
