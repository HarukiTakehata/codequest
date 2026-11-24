import type { RunRequest } from "@codequest/judge";
import { executeJs } from "./exec";

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  try {
    const response = await executeJs(event.data);
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      stdout: "",
      stderr: `Worker 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    });
  }
};
