import { afterEach, describe, expect, it, vi } from "vitest";
import { runScript } from "../src/client";
import type { ScriptWorkerRequest, ScriptWorkerResponse } from "../src/types";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<ScriptWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  request: ScriptWorkerRequest | null = null;

  constructor(readonly url: string | URL) {
    FakeWorker.instances.push(this);
  }

  postMessage(request: ScriptWorkerRequest) {
    this.request = request;
  }
}

const request: ScriptWorkerRequest = {
  source: "export function move() { game.player.move('up', 4); }",
  timeoutMs: 1000,
  cases: [{ name: "move", call: { fn: "move" }, expect: { "player.gold": 10 } }],
};

const response: ScriptWorkerResponse = {
  ok: true,
  passed: true,
  score: 100,
  results: [],
  ledgers: [],
  uncovered: {},
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe("Worker client boundary", () => {
  it("posts the request to a module Worker and terminates after a response", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const pending = runScript(request);
    const worker = FakeWorker.instances[0]!;
    expect(String(worker.url)).toContain("worker.ts");
    expect(worker.request).toEqual(request);
    worker.onmessage?.({ data: response } as MessageEvent<ScriptWorkerResponse>);
    await expect(pending).resolves.toEqual(response);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("force-terminates a timed-out Worker", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const pending = runScript({ ...request, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result.passed).toBe(false);
    expect(result.error).toContain("已强制终止");
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it("can be cancelled explicitly with AbortSignal", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const pending = runScript(request, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.error).toContain("已取消");
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  });
});
