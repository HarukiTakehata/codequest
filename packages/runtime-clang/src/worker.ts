import type { RunRequest } from "@codequest/judge";
import { executeCpp } from "./template";

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  try {
    self.postMessage(await executeCpp(event.data));
  } catch (error) {
    self.postMessage({
      stdout: "",
      stderr: `C/C++ Worker 错误: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    });
  }
};
