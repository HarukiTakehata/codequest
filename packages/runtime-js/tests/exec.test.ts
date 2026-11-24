import { describe, expect, it } from "vitest";
import { executeJs } from "../src/exec";
import type { RunRequest } from "@codequest/judge";

const req = (code: string, stdin = ""): RunRequest =>
  ({ lang: "javascript", code, stdin, timeoutMs: 5000 });

describe("JS runtime (design §5.2)", () => {
  it("captures console.log and reads stdin line by line", async () => {
    const result = await executeJs(req(
      'const a = Number(readline()); const b = Number(readline()); console.log("sum =", a + b);',
      "2\n3\n",
    ));
    expect(result).toMatchObject({ stdout: "sum = 5\n", stderr: "", exitCode: 0 });
    expect(result.logs).toEqual(["sum = 5\n"]);
  });

  it("reports thrown errors via stderr and non-zero exit", async () => {
    const result = await executeJs(req('console.log("before"); throw new Error("boom");'));
    expect(result.stdout).toBe("before\n");
    expect(result.stderr).toContain("Error: boom");
    expect(result.exitCode).toBe(1);
  });

  it("serializes objects as JSON and separates console.error", async () => {
    const result = await executeJs(req('console.log({a:1}); console.error("warn");'));
    expect(result.stdout).toBe('{"a":1}\n');
    expect(result.stderr).toBe("warn\n");
  });

  it("enforces the 1MB stdout budget", async () => {
    const result = await executeJs(req('for (let i=0;i<120000;i++) console.log("xxxxxxxxxx");'));
    expect(result.stdout).toContain("[输出超限，已终止]");
  });
});
