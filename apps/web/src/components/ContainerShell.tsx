import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, Terminal as TerminalIcon } from "lucide-react";
import { openShellSession, type ShellSessionLike } from "@codequest/runtime-shell/src/session-client";
import "@xterm/xterm/css/xterm.css";

interface Props { onBack: () => void }

/** 独立 Container Shell：最小镜像 rootfs + wasi-sh 常驻 busybox，xterm.js 真终端仿真。 */
export function ContainerShell({ onBack }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const session = useRef<ShellSessionLike | null>(null);
  const snapshot = useRef<Record<string, string>>({});

  const start = async () => {
    const terminal = term.current;
    if (!terminal) return;
    session.current?.terminate();
    terminal.clear();
    terminal.writeln("\x1b[36m正在启动 cq-minimal:cn shell 会话…\x1b[0m");
    const engine = await openShellSession(snapshot.current, {
      cols: terminal.cols, rows: terminal.rows,
    });
    session.current = engine;
    const decoder = new TextDecoder();
    engine.onOutput((bytes: Uint8Array) => terminal.write(decoder.decode(bytes)));
    // xterm 把完整的键盘字节流（Tab / 方向键 / Ctrl-C / vi 控制序列）直接送给 shell。
    terminal.onData((data) => engine.write(data));
    terminal.onBinary((data) => engine.write(data));
    terminal.onResize(({ cols, rows }) => engine.resize(cols, rows));
    void engine.exited.then((code) => terminal.writeln(`\r\n\x1b[33m[会话结束: ${code}]\x1b[0m`));
  };

  useEffect(() => {
    let alive = true;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      convertEol: true,
      scrollback: 2000,
      theme: { background: "#070b1c", foreground: "#b8f0c8", cursor: "#8ab4ff" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    term.current = terminal;
    fit.current = fitAddon;
    if (host.current) {
      terminal.open(host.current);
      fitAddon.fit();
    }
    // Ctrl+C 交给 shell（vi/长命令用），不刷新页面；其余快捷键由 xterm 处理。
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.key.toLowerCase() === "c") return true;
      return true;
    });
    const onWindowResize = () => { try { fitAddon.fit(); } catch { /* 未挂载 */ } };
    window.addEventListener("resize", onWindowResize);

    void Promise.all([
      fetch("/container-shell/rootfs.json").then((r) => r.json() as Promise<Record<string, string>>),
      fetch("/container-shell/applets.json").then((r) => r.json() as Promise<string[]>),
    ]).then(([files, list]) => {
      if (!alive) return;
      snapshot.current = files;
      void start().then(() => {
        if (!alive) return;
        terminal.writeln(`\x1b[90mrootfs: ${Object.keys(files).length} 个文件 / ${list.length} 个 applet\x1b[0m`);
        terminal.writeln("\x1b[90mbusybox 1.38 · vi 可用（:wq 保存 / :q! 退出）· Tab 补全 · 管道与重定向\x1b[0m");
      });
    }).catch((error) => terminal.writeln(`\x1b[31m快照载入失败: ${String(error)}\x1b[0m`));

    return () => {
      alive = false;
      window.removeEventListener("resize", onWindowResize);
      session.current?.terminate();
      terminal.dispose();
    };
    // 仅挂载时创建终端与会话；重启由按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="course-list container-shell">
      <header>
        <h1 className="icon-text"><TerminalIcon size={22} /> Container Shell</h1>
        <div className="icon-text">
          <span className="muted">cq-minimal:cn · busybox 1.38</span>
          <button className="ghost" onClick={() => void start()}><RotateCcw size={14} /> 重启会话</button>
          <button className="ghost" onClick={onBack}>返回课程列表</button>
        </div>
      </header>
      <p className="muted">独立容器终端：rootfs 快照在 Worker 内运行真实 busybox；键盘字节直接送入 shell，Tab 补全与 vi 全屏编辑均可用。</p>
      <div className="terminal-shell-window"><div className="xterm-host" ref={host} /></div>
    </div>
  );
}
