import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, Terminal as TerminalIcon } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface Props { onBack: () => void }

/** 独立 Container Shell：直接运行 c2w 转换的最小镜像，xterm.js 作为字节级终端。 */
export function ContainerShell({ onBack }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const start = async () => {
    const term = termRef.current;
    if (!term) return;
    stopRef.current?.();
    term.clear();
    const wasmUrl = "/runtime/cq-minimal.wasm";
    term.writeln(`\x1b[36m正在加载 ${wasmUrl}（首次启动较慢，请耐心等待）…\x1b[0m`);

    let container;
    try {
      const probe = await fetch(wasmUrl, { method: "HEAD" });
      if (!probe.ok) throw new Error(`HTTP ${probe.status} — 请先执行 npm run runtime:upload`);
      const contentType = probe.headers.get("content-type") ?? "";
      if (!contentType.includes("application/wasm")) throw new Error(`返回类型不是 wasm: ${contentType}`);
      const { createContainer } = await import("@webvirt/c2w");
      container = await createContainer({
        wasmUrl,
        command: ["/bin/sh"],
        env: { TERM: "xterm", PS1: "$ ", HOME: "/home/student" },
        onExit: (code) => term.writeln(`\r\n\x1b[33m[容器退出: ${code}]\x1b[0m`),
      });
    } catch (error) {
      term.writeln(`\r\n\x1b[31m容器启动失败: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
      term.writeln("\x1b[90m本地开发请先运行 npm run runtime:upload；线上运行 npm run runtime:upload:remote\x1b[0m");
      return;
    }

    let stopped = false;
    const stdin = container.stdio.stdin.getWriter();
    const stdout = container.stdio.stdout.getReader();
    const stderr = container.stdio.stderr.getReader();
    stopRef.current = () => {
      stopped = true;
      void stdin.close().catch(() => undefined);
      void stdout.cancel().catch(() => undefined);
      void stderr.cancel().catch(() => undefined);
    };

    const pump = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        term.write(decoder.decode(value, { stream: true }));
      }
    };
    void pump(stdout);
    void pump(stderr);

    // 真实终端：所有键盘字节（含 Tab、方向键、Ctrl-C、vi 控制序列）原样送入容器 stdin。
    term.onData((data) => { void stdin.write(encoder.encode(data)).catch(() => undefined); });
    term.onBinary((data) => { void stdin.write(encoder.encode(data)).catch(() => undefined); });
    term.focus();
  };

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 13, convertEol: false, scrollback: 4000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: { background: "#070b1c", foreground: "#b8f0c8", cursor: "#8ab4ff" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    termRef.current = terminal;
    fitRef.current = fitAddon;
    if (host.current) { terminal.open(host.current); fitAddon.fit(); }
    const onResize = () => { try { fitAddon.fit(); } catch { /* 未挂载 */ } };
    window.addEventListener("resize", onResize);
    void start();
    return () => {
      stopRef.current?.();
      window.removeEventListener("resize", onResize);
      terminal.dispose();
    };
  }, []);

  return (
    <div className="course-list container-shell">
      <header>
        <h1 className="icon-text"><TerminalIcon size={22} /> Container Shell</h1>
        <div className="icon-text">
          <span className="muted">cq-minimal:cn · 真实容器 shell / vi</span>
          <button className="ghost" onClick={() => void start()}><RotateCcw size={14} /> 重启容器</button>
          <button className="ghost" onClick={onBack}>返回课程列表</button>
        </div>
      </header>
      <p className="muted">直接运行 c2w 转换的最小镜像：完整 rootfs 与 busybox vi 均来自镜像本身；xterm.js 只做字节级终端仿真，不拦截命令。</p>
      <div className="terminal-shell-window"><div className="xterm-host" ref={host} /></div>
    </div>
  );
}
