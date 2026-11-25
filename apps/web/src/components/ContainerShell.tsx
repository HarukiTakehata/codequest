import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, Terminal as TerminalIcon } from "lucide-react";
import { openShellSession, type ShellSessionLike } from "@codequest/runtime-shell/src/session-client";
import { CodeEditor } from "./CodeEditor";
import "@xterm/xterm/css/xterm.css";

interface Props { onBack: () => void }

interface EditorState { path: string; content: string }

const RS = "\x1e";
const PROMPT = "\x1b[36m$\x1b[0m ";

/** 独立 Container Shell：最小镜像 rootfs + wasi-sh 常驻 busybox + xterm.js 真终端。 */
export function ContainerShell({ onBack }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const sessionRef = useRef<ShellSessionLike | null>(null);
  const filesRef = useRef<Record<string, string>>({});
  const appletsRef = useRef<string[]>([]);
  const lineRef = useRef("");
  const runningRef = useRef(false);
  const accRef = useRef("");
  const decoder = new TextDecoder();

  const prompt = (term: Terminal) => {
    term.write("", () => {
      term.write((term.buffer.active.cursorX > 0 ? "\r\n" : "") + PROMPT);
    });
  };

  const redraw = (term: Terminal) => term.write(`\r\x1b[2K${PROMPT}${lineRef.current}`);

  const complete = (term: Terminal) => {
    const line = lineRef.current;
    const match = line.match(/(\S*)$/);
    const token = match?.[0] ?? "";
    const commands = appletsRef.current;
    const paths = Object.keys(filesRef.current);
    const candidates = [...new Set([...commands, ...paths.map((p) => p.split("/").pop() ?? p)])]
      .filter((name) => name.startsWith(token));
    if (!candidates.length) return;
    if (candidates.length === 1) {
      lineRef.current = line.slice(0, line.length - token.length) + candidates[0]!;
      redraw(term);
      return;
    }
    term.write(`\r\n${candidates.slice(0, 40).join("  ")}\r\n`);
    redraw(term);
  };

  const runLine = (term: Terminal, raw: string) => {
    const cmd = raw.trim();
    if (!cmd) { prompt(term); return; }
    if (cmd === "clear") { term.clear(); prompt(term); return; }
    if (cmd === "help") {
      term.write("\r\n\x1b[90mTab 补全 · 方向键历史未启用 · vi 用 :wq 保存/:q! 退出 · Ctrl+C 中断\x1b[0m\r\n");
      prompt(term); return;
    }
    if (cmd === "reset") { void begin(); return; }
    if (cmd === "exit") { sessionRef.current?.write("exit\n"); return; }
    runningRef.current = true;
    // 完成标记与命令放在同一行，vi 等全屏程序不会把标记当成输入；
    // shell 在 vi 退出后才会执行 printf，于是我们能可靠恢复提示符。
    sessionRef.current?.write(`${cmd}; printf "\\036%d\\036" "$?"\n`);
  };

  const start = async () => {
    const term = termRef.current;
    if (!term) return;
    sessionRef.current?.terminate();
    term.clear();
    runningRef.current = false;
    lineRef.current = "";
    accRef.current = "";
    term.writeln("\x1b[36m正在启动 cq-minimal:cn shell 会话…\x1b[0m");
    const engine = await openShellSession(filesRef.current, { cols: term.cols, rows: term.rows });
    sessionRef.current = engine;
    engine.onOutput((bytes: Uint8Array) => {
      accRef.current += decoder.decode(bytes);
      for (;;) {
        const i = accRef.current.indexOf(RS);
        if (i < 0) { term.write(accRef.current); accRef.current = ""; return; }
        term.write(accRef.current.slice(0, i));
        const rest = accRef.current.slice(i + 1);
        const j = rest.indexOf(RS);
        if (j < 0) { accRef.current = RS + rest; return; }
        accRef.current = rest.slice(j + 1);
        runningRef.current = false;
        prompt(term);
      }
    });
    engine.onError((error) => term.writeln(`\r\n\x1b[31m[shell: ${error.message}]\x1b[0m`));
    void engine.exited.then((code) => term.writeln(`\r\n\x1b[33m[会话结束: ${code}]\x1b[0m`));
  };

  /** 启动（或重启）会话后只绘制一次提示符。 */
  const begin = async (intro = false) => {
    const term = termRef.current;
    if (!term) return;
    if (intro) {
      term.writeln(`\x1b[90mrootfs: ${Object.keys(filesRef.current).length} 个文件 / ${appletsRef.current.length} 个 applet\x1b[0m`);
      term.writeln("\x1b[90mTab 补全 · vi 全屏编辑 · Ctrl+C 中断\x1b[0m");
    }
    await start();
    prompt(term);
    term.focus();
  };

  useEffect(() => {
    let alive = true;
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 13, convertEol: true, scrollback: 2000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: { background: "#070b1c", foreground: "#b8f0c8", cursor: "#8ab4ff" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    termRef.current = terminal;
    if (host.current) { terminal.open(host.current); fitAddon.fit(); }
    const onResize = () => { try { fitAddon.fit(); } catch { /* 未挂载 */ } };
    window.addEventListener("resize", onResize);

    // 键盘到 shell：未运行命令时本地行编辑，运行中把原始字节直接送入（vi/Tab/方向键）。
    terminal.onData((data) => {
      const session = sessionRef.current;
      if (!session) return;
      if (runningRef.current) {
        const i = data.indexOf("\x03");
        if (i < 0) { session.write(data); return; }
        if (i > 0) session.write(data.slice(0, i));
        terminal.write("^C");
        session.interrupt();
        return;
      }
      for (const ch of data) {
        if (ch === "\r") {
          terminal.write("\r\n");
          const line = lineRef.current;
          lineRef.current = "";
          runLine(terminal, line);
        } else if (ch === "\x7f" || ch === "\b") {
          if (lineRef.current) { lineRef.current = lineRef.current.slice(0, -1); terminal.write("\b \b"); }
        } else if (ch === "\x03") {
          lineRef.current = ""; terminal.write("^C"); prompt(terminal);
        } else if (ch === "\x0c") {
          terminal.clear(); redraw(terminal);
        } else if (ch === "\t") {
          complete(terminal);
        } else if (ch >= " ") {
          lineRef.current += ch; terminal.write(ch);
        }
      }
    });
    terminal.onResize(({ cols, rows }) => sessionRef.current?.resize(cols, rows));
    terminal.attachCustomKeyEventHandler(() => true);

    void Promise.all([
      fetch("/container-shell/rootfs.json").then((r) => r.json() as Promise<Record<string, string>>),
      fetch("/container-shell/applets.json").then((r) => r.json() as Promise<string[]>),
    ]).then(([files, list]) => {
      if (!alive) return;
      filesRef.current = files;
      appletsRef.current = list;
      void begin(true);
    }).catch((error) => terminal.writeln(`\x1b[31m快照载入失败: ${String(error)}\x1b[0m`));

    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      sessionRef.current?.terminate();
      terminal.dispose();
    };
  }, []);

  return (
    <div className="course-list container-shell">
      <header>
        <h1 className="icon-text"><TerminalIcon size={22} /> Container Shell</h1>
        <div className="icon-text">
          <span className="muted">cq-minimal:cn · busybox 1.38</span>
          <button className="ghost" onClick={() => void begin()}><RotateCcw size={14} /> 重启会话</button>
          <button className="ghost" onClick={onBack}>返回课程列表</button>
        </div>
      </header>
      <p className="muted">独立容器终端：rootfs 快照在 Worker 内运行真实 busybox；xterm.js 处理全部键盘事件，Tab 补全与 vi 全屏编辑可用。</p>
      <div className="terminal-shell-window"><div className="xterm-host" ref={host} /></div>
    </div>
  );
}
