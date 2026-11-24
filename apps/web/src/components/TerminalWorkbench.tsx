import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw } from "lucide-react";
import { openContainerSession } from "@codequest/runtime-shell/src/container-runtime";
import { ContainerStartupProgress, type ContainerStartupProgressState } from "./ContainerStartupProgress";
import type { Challenge } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import { terminalTheme } from "../terminal-theme";
import { TerminalFrame } from "./TerminalFrame";

interface Props {
  challenge: Challenge;
  onClose: () => void;
}

/** Bandit 式探索会话：xterm 字节流直接连接 c2w 真实容器，不在前端解释命令。 */
export function TerminalWorkbench({ challenge, onClose }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const tRef = useRef(t);
  tRef.current = t;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const inputDisposablesRef = useRef<Array<{ dispose(): void }>>([]);
  const progressChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionGeneration = useRef(0);
  const [progress, setProgress] = useState<ContainerStartupProgressState | null>(null);
  const encoder = new TextEncoder();

  const start = async () => {
    const term = termRef.current;
    if (!term) return;
    const generation = ++sessionGeneration.current;
    stopRef.current?.();
    inputDisposablesRef.current = [];
    progressChannelRef.current?.close();
    progressChannelRef.current = null;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("codequest-c2w-progress");
      channel.onmessage = (event: MessageEvent<ContainerStartupProgressState>) => {
        const next = event.data;
        if (!next || !["downloading", "starting", "error"].includes(next.phase)) return;
        if (generation !== sessionGeneration.current) return;
        if (next.requestId && next.requestId !== "shell-terminal") return;
        setProgress({
          ...next,
          loaded: Number.isFinite(next.loaded) ? next.loaded : 0,
          total: Number.isFinite(next.total) ? next.total : 0,
          message: next.message?.slice(0, 200),
        });
      };
      progressChannelRef.current = channel;
    }
    setProgress({ phase: "downloading", loaded: 0, total: 0 });
    term.clear();

    // 字体与布局稳定后只测量一次；WASI 版 c2w 的 TTY 尺寸启动后无法更新。
    if (document.fonts) await document.fonts.ready.catch(() => undefined);
    try { fitRef.current?.fit(); } catch { /* 终端可能正在卸载 */ }
    const terminalSize = { cols: term.cols, rows: term.rows };
    if (host.current) {
      host.current.dataset.terminalCols = String(terminalSize.cols);
      host.current.dataset.terminalRows = String(terminalSize.rows);
    }

    let stopped = false;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let session;
    try {
      session = await openContainerSession(challenge.presetFiles, {
        requestId: "shell-terminal",
        terminalSize,
        onExit: (code) => {
          if (generation !== sessionGeneration.current || stopped) return;
          stopped = true;
          if (startupTimer) clearTimeout(startupTimer);
          for (const disposable of inputDisposablesRef.current) disposable.dispose();
          inputDisposablesRef.current = [];
          setProgress(null);
          term.writeln(`\r\n\x1b[33m${tRef.current("terminal.exited", { code })}\x1b[0m`);
        },
      });
      if (generation !== sessionGeneration.current) { session.close(); return; }
      setProgress((current) => current?.phase === "error" ? current : { phase: "starting" });
    } catch (error) {
      if (generation !== sessionGeneration.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setProgress({ phase: "error", message });
      term.writeln(`\r\n\x1b[31m${tRef.current("terminal.startFailed", { message })}\x1b[0m`);
      return;
    }

    let stdoutStarted = false;
    const stdin = session.stdio.stdin.getWriter();
    const stdout = session.stdio.stdout.getReader();
    const stderr = session.stdio.stderr.getReader();
    stopRef.current = () => {
      stopped = true;
      if (startupTimer) clearTimeout(startupTimer);
      for (const disposable of inputDisposablesRef.current) disposable.dispose();
      inputDisposablesRef.current = [];
      session.close(stdin, { stdout, stderr });
    };

    const pump = async (reader: ReadableStreamDefaultReader<Uint8Array>, name: "stdout" | "stderr") => {
      const streamDecoder = new TextDecoder();
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        if (name === "stdout") {
          stdoutStarted = true;
          if (startupTimer) clearTimeout(startupTimer);
          setProgress(null);
        }
        term.write(streamDecoder.decode(value, { stream: true }));
      }
    };
    void pump(stdout, "stdout");
    void pump(stderr, "stderr");
    startupTimer = setTimeout(() => {
      if (stopped || stdoutStarted || generation !== sessionGeneration.current) return;
      stopRef.current?.();
      setProgress({ phase: "error", message: tRef.current("terminal.timeout") });
      term.writeln(`\r\n\x1b[31m${tRef.current("terminal.timedOut")}\x1b[0m`);
    }, 30_000);

    inputDisposablesRef.current = [
      term.onData((data) => { void stdin.write(encoder.encode(data)).catch(() => undefined); }),
      term.onBinary((data) => {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        void stdin.write(bytes).catch(() => undefined);
      }),
    ];
    term.focus();
  };

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      convertEol: false,
      scrollback: 4000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: terminalTheme(theme),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    termRef.current = terminal;
    fitRef.current = fitAddon;
    if (host.current) {
      terminal.open(host.current);
      fitAddon.fit();
    }
    void start();
    return () => {
      sessionGeneration.current++;
      stopRef.current?.();
      progressChannelRef.current?.close();
      progressChannelRef.current = null;
      termRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  return (
    <div className="workbench terminal">
      <header>
        <div><span className="tag lang">shell</span><strong>{challenge.title}</strong></div>
        <div className="icon-text">
          <button className="button button-ghost" onClick={() => void start()}><RotateCcw size={14} />{t("terminal.restart")}</button>
          <button className="button button-ghost" onClick={onClose}>{t("terminal.close")}</button>
        </div>
      </header>
      <TerminalFrame hostRef={host} title={challenge.title} />
      {progress && <ContainerStartupProgress progress={progress} />}
    </div>
  );
}
