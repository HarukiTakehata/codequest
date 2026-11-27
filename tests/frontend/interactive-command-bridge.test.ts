import { describe, expect, it } from "vitest";
import { INTERACTIVE_SHELL_PROMPT } from "../../packages/runtime-shell/src/container-runtime";
import { ContainerTerminalBusyError, InteractiveCommandBridge } from "../../packages/runtime-shell/src/interactive-command-bridge";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const writes: string[] = [];
  const terminal: string[] = [];
  const stream = new WritableStream<Uint8Array>({ write(chunk) { writes.push(decoder.decode(chunk)); } });
  let readyCount = 0;
  let userCommands = 0;
  const bridge = new InteractiveCommandBridge({
    writer: stream.getWriter(),
    onTerminalOutput: (text) => terminal.push(text),
    onShellReady: () => { readyCount++; },
    onUserCommandComplete: () => { userCommands++; },
  });
  return { bridge, writes, terminal, readyCount: () => readyCount, userCommands: () => userCommands };
}

function frameFrom(write: string) {
  const start = write.match(/__CQ_[a-z0-9]{8}__/)?.[0];
  const end = write.match(/__CQ_END_[a-z0-9]{8}__/)?.[0];
  if (!start || !end) throw new Error("Missing command frame");
  return { start, end };
}

describe("交互 c2w 可见命令桥", () => {
  it("只认唯一 Shell 提示符，并忽略末尾光标查询", () => {
    const h = harness();
    expect(h.readyCount()).toBe(0);
    h.bridge.pushStdout("container booting");
    h.bridge.pushStdout("\r\n$ ");
    expect(h.bridge.isShellIdle).toBe(false);
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT + "\x1b[6n");
    expect(h.bridge.isShellIdle).toBe(true);
    expect(h.readyCount()).toBe(1);
    h.bridge.close();
  });

  it("前台进程未返回提示符时拒绝文件命令，不向 stdin 写字节", async () => {
    const h = harness();
    h.bridge.pushStdout("$ sleep 30\r\n");
    await expect(h.bridge.run("pwd -P")).rejects.toBeInstanceOf(ContainerTerminalBusyError);
    expect(h.writes).toEqual([]);
    h.bridge.close();
  });

  it("真实命令与全部输出原样可见，只额外观察结果标记", async () => {
    const h = harness();
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    const pending = h.bridge.run("printf 'out\\n'; printf 'err\\n' >&2");
    await tick();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toContain("( printf 'out\\n'; printf 'err\\n' >&2; ) 2>&1");
    expect(h.writes[0]).not.toContain("/bin/sh -c");
    expect(h.writes[0]).not.toContain("CQ_FILE_CODE");
    expect(h.writes[0]).not.toContain("stty");
    expect(h.writes[0]).not.toContain("PS1=");
    expect(h.writes[0].length).toBeLessThan(180);
    const frame = frameFrom(h.writes[0]);
    const echoed = `$ printf '\\n%s\\n' ${frame.start}; ( printf out; ) 2>&1\r\n`;
    h.bridge.pushStdout(echoed);
    h.bridge.pushStdout(`\r\n${frame.start}\r\nout\r\nerr\r\n${frame.end}:7\r\n`);
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    await expect(pending).resolves.toEqual({ stdout: "out\nerr", exitCode: 7 });
    const visible = h.terminal.join("");
    expect(visible).toContain(echoed);
    expect(visible).toContain(frame.start);
    expect(visible).toContain("out\r\nerr");
    expect(visible).toContain(frame.end);
    h.bridge.close();
  });

  it("命令结果先等待最终提示符，避免后续管理器命令在 shell 仍忙时注入", async () => {
    const h = harness();
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    let settled = false;
    const pending = h.bridge.run("pwd -P").then((result) => { settled = true; return result; });
    await tick();
    const frame = frameFrom(h.writes[0]);
    h.bridge.pushStdout(`\r\n${frame.start}\r\n/home/student\r\n${frame.end}:0\r\n`);
    await tick();
    expect(settled).toBe(false);
    expect(h.bridge.isShellIdle).toBe(false);
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    await expect(pending).resolves.toEqual({ stdout: "/home/student", exitCode: 0 });
    h.bridge.close();
  });

  it("多行文本写回也完整回显，不切换终端回显状态", async () => {
    const h = harness();
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    const pending = h.bridge.runInput("printf %s 'line 1\nline 2' > '/home/student/a.txt'");
    await tick();
    expect(h.writes[0]).toContain("line 1\nline 2");
    expect(h.writes[0]).not.toContain("stty");
    const frame = frameFrom(h.writes[0]);
    h.bridge.pushStdout("$ printf %s 'line 1\r\n> line 2' > '/home/student/a.txt'\r\n");
    h.bridge.pushStdout(`\r\n${frame.start}\r\n${frame.end}:0\r\n${INTERACTIVE_SHELL_PROMPT}`);
    await expect(pending).resolves.toEqual({ stdout: "", exitCode: 0 });
    expect(h.terminal.join("")).toContain("line 1");
    expect(h.terminal.join("")).toContain("line 2");
    h.bridge.close();
  });

  it("用户终端命令回到提示符后触发一次同步通知，输出不丢失", async () => {
    const h = harness();
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    await h.bridge.sendInput("cd /tmp\n");
    h.bridge.pushStdout("cd /tmp\r\n");
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    expect(h.userCommands()).toBe(1);
    expect(h.terminal.join("")).toContain("cd /tmp\r\n");
    h.bridge.close();
  });

  it("光标查询回复优先写入，不会被排到文件命令之后", async () => {
    const h = harness();
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    const pending = h.bridge.run("pwd -P");
    await tick();
    await h.bridge.sendInput("\x1b[2;3R");
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toBe("\x1b[2;3R");
    h.bridge.close();
    await expect(pending).rejects.toThrow();
  });

  it("关闭会话会拒绝等待中的命令", async () => {
    const h = harness();
    h.bridge.pushStdout(INTERACTIVE_SHELL_PROMPT);
    const pending = h.bridge.run("pwd -P");
    await tick();
    h.bridge.close();
    await expect(pending).rejects.toThrow();
  });
});
