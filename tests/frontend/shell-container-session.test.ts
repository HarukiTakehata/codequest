import { describe, expect, it } from "vitest";
import {
  buildContainerGoalCheckScript,
  buildContainerInitialization,
  buildContainerRunBlock,
  buildInteractiveContainerCommand,
  parseContainerGoalChecks,
} from "../../packages/runtime-shell/src/container-runtime";
import type { Goal } from "../../packages/judge/src/types";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{
  readFileSync(path: URL, encoding: string): string;
  existsSync(path: URL): boolean;
}>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Shell 常驻真实容器会话", () => {
  it("初始文件与 stdin 被写成容器内真实文件", () => {
    const command = buildContainerInitialization({ "/home/student/secret.txt": "CQ{real-container}\n" }, "input\n");
    expect(command.join("\n")).toContain("mkdir -p '/home/student'");
    expect(command.join("\n")).toContain("base64 -d > '/home/student/secret.txt'");
    expect(command.join("\n")).toContain("base64 -d > '/tmp/cq-stdin'");
    expect(command.join("\n")).toContain("set -eu");
    expect(command.join("\n")).toContain('[ "$init_status" -eq 0 ] || exit "$init_status"');
  });

  it("会话内执行块输出独立 stdout/stderr 标记，不依赖 stdout EOF", () => {
    const block = buildContainerRunBlock("cat", "hello\n", 5000, "__RESULT__", "__STDERR__", "__END__");
    expect(block).toContain("timeout -k 1 4s /bin/sh '/tmp/cq-run-run/script.sh'");
    expect(block).toContain("sleep 4; : > '/tmp/cq-run-run/timed-out'");
    expect(block).toContain("if [ -e '/tmp/cq-run-run/timed-out' ]; then code=124; fi");
    expect(block).toContain("mkfifo '/tmp/cq-run-run/stdout.fifo' '/tmp/cq-run-run/stderr.fifo'");
    expect(block).toContain("head -c 1048576 < '/tmp/cq-run-run/stdout.fifo'");
    expect(block).toContain("> '/tmp/cq-run-run/stdout.fifo' 2> '/tmp/cq-run-run/stderr.fifo'");
    expect(block).toContain("__RESULT__");
    expect(block).toContain("__STDERR__");
    expect(block).toContain("__END__");
  });

  it("并发排队时每次运行仍使用独立临时目录并清理", () => {
    const first = buildContainerRunBlock("echo first", "", 5000, "__A__", "__AE__", "__AX__", "run-a");
    const second = buildContainerRunBlock("echo second", "", 5000, "__B__", "__BE__", "__BX__", "run-b");
    expect(first).toContain("/tmp/cq-run-run-a/");
    expect(second).toContain("/tmp/cq-run-run-b/");
    expect(first).not.toContain("/tmp/cq-run-run-b/");
    expect(first).toContain("rm -rf '/tmp/cq-run-run-a'");
  });

  it("file-exists 与 command-stdout 在同一容器会话中探测并回传类型化结果", () => {
    const goals: Goal[] = [
      { id: "file", text: "文件存在", check: { kind: "file-exists", path: "/home/student/a b" } },
      { id: "cmd", text: "命令输出", check: { kind: "command-stdout", command: "cat /flag", expect: "CQ{ok}\n" } },
    ];
    const script = buildContainerGoalCheckScript(goals);
    expect(script).toContain("[ -e '/home/student/a b' ]");
    expect(script).toContain("/bin/sh -c 'cat /flag'");
    expect(script).toContain("cmp -s '/tmp/cq-goal-1.stdout' '/tmp/cq-goal-1.expected'");
    expect(parseContainerGoalChecks(goals, "\n__CQ_GOAL_0__=1\n__CQ_GOAL_1__=0\n")).toEqual({ file: true, cmd: false });
  });

  it("默认 Shell 会话使用新开发容器工件", () => {
    const source = read("packages/runtime-shell/src/container-runtime.ts");
    expect(source).toContain('const DEFAULT_WASM_URL = "/runtime/cq-dev-shell.wasm"');
    expect(source).not.toContain("cq-minimal");
  });

  it("自动会话关闭 TTY 回显并启动真实 /bin/sh", () => {
    const command = buildInteractiveContainerCommand({}, true);
    expect(command).toContain("stty -echo");
    expect(command).toContain("PS1=");
    expect(command).toContain("exec /bin/sh");
  });

  it("Shell 题目进入即启动容器，运行复用会话，重置与退出销毁", () => {
    const source = read("apps/web/src/components/Workbench.tsx");
    expect(source).toContain("openAutomatedContainerSession");
    expect(source).toContain("buildContainerGoalCheckScript");
    expect(source).toContain("parseContainerGoalChecks");
    expect(source).toContain("files: usesContainer ? {} : files");
    expect(source).toContain("void startShellContainer()");
    expect(source).toContain("const session = shellSessionRef.current");
    expect(source).toContain("return session.run");
    expect(source).toContain('t("workbench.resetContainer")');
    expect(source).toContain("session?.close()");
    expect(source).toContain("requestId: \"shell-course\"");
    expect(source).toContain("return closeShellSession");
    expect(source).not.toContain("runWasiSh");
    expect(source).not.toContain("executeShell");
  });

  it("自由模式 Shell 标签进入即启动，切换语言与退出清理", () => {
    const source = read("apps/web/src/components/FreeMode.tsx");
    expect(source).toContain("openAutomatedContainerSession");
    expect(source).toContain('if (lang !== "shell") { closeShellSession(); return; }');
    expect(source).toContain("const session = shellSessionRef.current");
    expect(source).toContain("return session.run");
    expect(source).toContain("loadedLang");
    expect(source).toContain("selectLanguage");
    expect(source).toContain("disabled={busy} onClick={() => selectLanguage(item.id)}");
    expect(source).toContain("session?.close()");
    expect(source).toContain('t("workbench.resetContainer")');
    expect(source).not.toContain("runWasiSh");
  });

  it("可选 goals 不阻断提交，探索终端关闭后进入令牌门", () => {
    const workbench = read("apps/web/src/components/Workbench.tsx");
    expect(workbench).toContain("const goalsSatisfied = !challenge.requireAllGoals || allDone");
    expect(workbench).toContain("disabled={disabled || !judgeConfig || !goalsSatisfied}");
    const stage = read("apps/web/src/components/Stage.tsx");
    expect(stage).toContain("onClose={() => { setActive(null); advance(); }}");
  });

  it("通用 runCode 拒绝 Shell 一次性运行，防止绕过常驻会话", () => {
    const source = read("apps/web/src/runners.ts");
    expect(source).toContain("Shell 必须通过常驻容器会话运行");
    expect(source).not.toContain("wasi-client");
  });

  it("模拟 shell、wasi-sh 运行时与旧快照文件已删除", () => {
    for (const path of [
      "packages/runtime-shell/src/shell.ts",
      "packages/runtime-shell/src/vfs.ts",
      "packages/runtime-shell/src/client.ts",
      "packages/runtime-shell/src/worker.ts",
      "packages/runtime-shell/src/session-client.ts",
      "packages/runtime-shell/src/wasi-client.ts",
      "apps/web/public/container-shell/rootfs.json",
      "tmp-xterm-harness.mjs",
    ]) expect(fs.existsSync(new URL(`../../${path}`, import.meta.url)), path).toBe(false);
  });
});
