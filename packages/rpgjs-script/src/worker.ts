import { judgeScript } from "./judge";
import type { ScriptJudgeReport, ScriptWorkerRequest } from "./types";

function workerFailure(message: string): ScriptJudgeReport {
  return {
    ok: false,
    passed: false,
    score: 0,
    error: message,
    results: [],
    ledgers: [],
    uncovered: {},
  };
}

/** User scripts are interpreted only here, inside the dedicated Worker. */
self.onmessage = async (event: MessageEvent<ScriptWorkerRequest>) => {
  try {
    const response = await judgeScript(event.data);
    self.postMessage(response);
  } catch (error) {
    self.postMessage(workerFailure(
      `Worker 执行失败: ${error instanceof Error ? error.message : String(error)}`,
    ));
  }
};
