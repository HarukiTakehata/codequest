import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../../apps/web/src/components/ContainerShell.tsx", import.meta.url), "utf8");
const manager = readFileSync(new URL("../../apps/web/src/components/ContainerFileManager.tsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../../packages/runtime-shell/src/interactive-command-bridge.ts", import.meta.url), "utf8");

describe("Container Shell 文件管理器接入", () => {
  it("复用同一个交互会话、stdin writer 与 stdout pump", () => {
    expect(shell).toContain("new InteractiveCommandBridge");
    expect(shell).toContain("bridge.pushStdout(text)");
    expect(shell).toContain("bridge.sendInput(data)");
    expect(shell).toContain("<ContainerFileManager bridge={fileBridge}");
    expect(shell.match(/openContainerSession\(/g)).toHaveLength(1);
    expect(manager).not.toContain("openContainerSession");
    expect(manager).not.toContain("openAutomatedContainerSession");
  });

  it("所有终端字节先透传，结果标记只观察不过滤", () => {
    expect(bridge).toContain("this.onTerminalOutput(text);");
    expect(bridge.indexOf("this.onTerminalOutput(text);")).toBeLessThan(bridge.indexOf("this.parseCommand();"));
    expect(bridge).toContain("if (!this.idle || this.active) throw new ContainerTerminalBusyError()");
    expect(bridge).toContain("( ${oneLine}; ) 2>&1");
    expect(bridge).not.toContain("/bin/sh -c");
    expect(bridge).not.toContain("stty");
    expect(bridge).not.toContain("PS1=");
    expect(bridge).not.toContain("hidingPreparation");
  });

  it("终端用户命令完成后通知文件管理器刷新", () => {
    expect(shell).toContain("onUserCommandComplete");
    expect(shell).toContain("activityToken={terminalActivity}");
    expect(shell).toContain("idle={shellIdle}");
    expect(manager).toContain("[activityToken]");
    expect(manager).toContain("buildWorkspaceSnapshotCommand");
    expect(manager).toContain("parseWorkspaceSnapshot");
    expect(manager).toContain("buildListCommand");
  });

  it("重置代次、就绪状态和本地 Material 图标都接入 UI", () => {
    expect(shell).toContain("setShellReady(false)");
    expect(shell).toContain("resetKey={`${sessionGeneration.current}:${environmentId}`}");
    expect(manager).toContain('data-ready={ready}');
    expect(manager).toContain('data-idle={idle}');
    expect(manager).toContain('src={materialIconUrl(entry');
    expect(manager).toContain('/vendor/material-icon-theme/icons/folder-root-open.svg');
    expect(manager).toContain('from "lucide-react"');
    expect(manager).not.toMatch(/https?:\/\/[^"']+\.svg/);
    expect(manager).not.toContain("setInputFiles");
  });

  it("文本预览有大小上限，危险操作需要确认", () => {
    expect(manager).toContain("MAX_TEXT_FILE_BYTES");
    expect(manager).toContain("runInput(buildWriteCommand");
    expect(manager).toContain("buildDeleteCommand");
    expect(manager).toContain('dialog.kind === "delete"');
    expect(manager).toContain("files.deleteConfirm");
  });
});
