import type { RunRequest } from "@codequest/judge";
import { executeShell } from "./shell";

self.onmessage = (event: MessageEvent<RunRequest>) => {
  try {
    self.postMessage(executeShell(event.data));
  } catch (error) {
    self.postMessage({
      stdout: "",
      stderr: `Shell Worker 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
      files: event.data.files ?? {},
      cwd: "/home/student",
    });
  }
};
