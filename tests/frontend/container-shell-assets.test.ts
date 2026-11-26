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
    expect(source).toContain("/runtime/cq-minimal.wasm?env=${selectedId}");
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

  it("左下角进度组件固定、主题化半透明，启动条使用滚动动画", () => {
    const component = read("apps/web/src/components/ContainerStartupProgress.tsx");
    const styles = read("apps/web/src/styles.css");
    expect(component).toContain("is-determinate");
    expect(component).toContain("is-indeterminate");
    expect(styles).toContain(".container-startup-progress { position: fixed; left: 20px; bottom: 20px;");
    expect(styles).toContain("background: hsl(var(--card) / 0.84)");
    expect(styles).toContain("@keyframes container-startup-scroll");
  });
});
