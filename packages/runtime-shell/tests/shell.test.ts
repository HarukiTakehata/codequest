import { describe, expect, it } from "vitest";
import { executeShell, tokenize } from "../src/shell";
import type { RunRequest } from "@codequest/judge";

const req = (code: string, files: Record<string, string> = {}): RunRequest =>
  ({ lang: "shell", code, stdin: "", files, timeoutMs: 5000 });

describe("shell runtime (design §5.5 teaching subset)", () => {
  it("tokenizes quotes, pipes and redirects", () => {
    expect(tokenize('echo "a b" | grep a > out.txt')).toEqual([
      "echo", "a b", "|", "grep", "a", ">", "out.txt",
    ]);
  });

  it("supports Bandit-style exploration: find a file and cat the flag", () => {
    const result = executeShell(req(
      "cd /home/student\nls\ngrep -i 'cq{' secret.txt",
      { "/home/student/secret.txt": "nothing here\nCQ{bandit-one}\n" },
    ));
    expect(result.stdout).toContain("secret.txt");
    expect(result.stdout).toContain("CQ{bandit-one}");
    expect(result.exitCode).toBe(0);
  });

  it("supports pipelines, sorting and redirects with side effects", () => {
    const result = executeShell(req(
      "printf_placeholder\ncat words.txt | sort | uniq -c > counts.txt\ncat counts.txt",
      { "/home/student/words.txt": "b\na\nb\n" },
    ), );
    // 第一条命令不存在仅产生 stderr；后续管道与重定向仍生效。
    expect(result.files["/home/student/counts.txt"]).toContain("2 b");
    expect(result.stdout).toContain("2 b");
    expect(result.stderr).toContain("command not found");
  });

  it("evaluates file-exists goals through the returned filesystem", () => {
    const result = executeShell(req("touch /home/student/test.sh\nmkdir -p /tmp/x\necho done", {}));
    expect("/home/student/test.sh" in result.files).toBe(true);
    expect(result.stdout).toBe("done\n");
  });

  it("reports unknown commands without throwing", () => {
    const result = executeShell(req("definitely_not_a_command"));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("command not found");
  });
});
