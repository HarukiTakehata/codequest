import { describe, expect, it } from "vitest";
import { builtin } from "../helpers/sqlite-d1";

const fs = builtin<{ readFileSync(path: URL, encoding: string): string }>("node:fs");
const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Container Shell 与课程终端使用真实容器", () => {
  it("ContainerShell 通过常驻 c2w 会话连接字节流，不拦截命令", () => {
    const source = read("apps/web/src/components/ContainerShell.tsx");
    expect(source).toContain("openContainerSession");
    expect(source).toContain("new Terminal");
    expect(source).toContain("term.onData");
    expect(source).toContain("stdio.stdin");
    expect(source).toContain("ContainerStartupProgress");
    expect(source).toContain("container-environment-select");
    expect(source).toContain("container-environments.json");
    expect(source).toContain("cq-dev-");
    expect(source).toContain("codequest-c2w-progress");
    expect(source).toContain("`/runtime/cq-dev-${selectedId}.wasm${suffix}`");
    expect(source).toContain('query.set("sha256", selected.sha256)');
    expect(source).not.toContain("cq-minimal");
    expect(source).toContain("disabled={!available}");
    expect(source).toContain("sessionGeneration");
    expect(source).toContain("inputDisposablesRef");
    expect(source).toContain("session.close(stdin, { stdout, stderr })");
    expect(source).toContain("manifestReady");
    expect(source).toContain("if (done || stopped) break");
    expect(source).toContain("atob(data)");
    expect(source).not.toContain("runShell");
    expect(source).not.toContain("executeShell");
    expect(source).not.toContain("setEditor");
  });

  it("课程探索终端是 xterm 真实容器会话，没有模拟输入框或命令分发", () => {
    const source = read("apps/web/src/components/TerminalWorkbench.tsx");
    expect(source).toContain("openContainerSession");
    expect(source).toContain("new Terminal");
    expect(source).toContain("term.onData");
    expect(source).toContain("sessionGeneration");
    expect(source).toContain("streamDecoder");
    expect(source).toContain("session.close(stdin, { stdout, stderr })");
    expect(source).toContain("if (done || stopped) break");
    expect(source).toContain("atob(data)");
    expect(source).not.toContain("runShell");
    expect(source).not.toContain("executeShell");
    expect(source).not.toContain("<input");
    expect(source).not.toContain("MVP 内存文件系统");
  });
});
