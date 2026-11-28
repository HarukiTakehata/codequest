import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptWorkerRequest } from "../src/types";

type WorkerHandler = (event: { data: ScriptWorkerRequest }) => void | Promise<void>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Worker entry", () => {
  it("interprets the script and posts a structured verdict", async () => {
    const target: { onmessage: WorkerHandler | null; postMessage: ReturnType<typeof vi.fn> } = {
      onmessage: null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal("self", target);
    await import("../src/worker");
    expect(target.onmessage).toBeTypeOf("function");

    await target.onmessage?.({
      data: {
        source: "export function move() { game.player.move('up', 4); }",
        cases: [{
          name: "move",
          call: { fn: "move" },
          expect: { "effect:player.moveRoutes:args.0.0.up": 4 },
        }],
      },
    });

    expect(target.postMessage).toHaveBeenCalledOnce();
    const response = target.postMessage.mock.calls[0]![0];
    expect(response).toMatchObject({ ok: true, passed: true, score: 100 });
    expect(response.results[0].result.effects[0].params).toEqual({ args: [[{ up: 4 }]] });
  });
});
