import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ArrowLeft, RotateCcw, Terminal as TerminalIcon } from "lucide-react";
import { ContainerStartupProgress, type ContainerStartupProgressState } from "./ContainerStartupProgress";
import { openContainerSession } from "@codequest/runtime-shell/src/container-runtime";
import { DEFAULT_CONTAINER_ENVIRONMENTS, type ContainerEnvironment } from "../container-environments";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import { terminalTheme } from "../terminal-theme";
import { observeTerminalLayout } from "../terminal-layout";
import { TerminalFrame } from "./TerminalFrame";
import "@xterm/xterm/css/xterm.css";

interface Props { onBack: () => void }

/** 独立 Container Shell：直接运行 c2w 转换的最小镜像，xterm.js 作为字节级终端。 */
export function ContainerShell({ onBack }: Props) {
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
  const [environments, setEnvironments] = useState<ContainerEnvironment[]>(DEFAULT_CONTAINER_ENVIRONMENTS);
  const [manifestReady, setManifestReady] = useState(false);
  const [environmentId, setEnvironmentId] = useState<ContainerEnvironment["id"]>("shell");
  const encoder = new TextEncoder();

  useEffect(() => {
    void fetch("/container-environments.json")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(tRef.current("container.manifestUnavailable"))))
      .then((items: ContainerEnvironment[]) => {
        if (!Array.isArray(items) || !items.length) return;
        setEnvironments(items);
      })
      .catch(() => undefined)
      .finally(() => setManifestReady(true));
  }, []);

  const start = async (selectedId: ContainerEnvironment["id"] = environmentId) => {
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
        if (next.requestId && next.requestId !== selectedId) return;
        if (next.environment && next.environment !== selectedId) return;
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
    const selected = environments.find((item) => item.id === selectedId) ?? environments[0];
    const query = new URLSearchParams();
    query.set("env", selectedId);
    if (selected?.bytes) query.set("bytes", String(selected.bytes));
    if (selected?.sha256) query.set("v", selected.sha256.slice(0, 12));
    const queryText = query.toString();
    const suffix = queryText ? `?${queryText}` : "";
    const wasmUrl = selectedId === "shell" && !selected?.bytes
      ? `/runtime/cq-minimal.wasm?env=${selectedId}`
      : `/runtime/cq-dev-${selectedId}.wasm${suffix}`;
    term.writeln(`\x1b[36m${tRef.current("container.loading", { name: selected?.name ?? selectedId })}\x1b[0m`);

    let stopped = false;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let session;
    try {
      session = await openContainerSession({}, {
        wasmUrl,
        requestId: selectedId,
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
      term.writeln(`\x1b[90m${tRef.current("terminal.uploadHint")}\x1b[0m`);
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

    // 真实终端：所有键盘字节（含 Tab、方向键、Ctrl-C、vi 控制序列）原样送入容器 stdin。
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
      cursorBlink: true, fontSize: 13, convertEol: false, scrollback: 4000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: terminalTheme(theme),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    termRef.current = terminal;
    fitRef.current = fitAddon;
    let stopObserving: (() => void) | undefined;
    if (host.current) {
      terminal.open(host.current);
      fitAddon.fit();
      stopObserving = observeTerminalLayout(host.current, () => fitAddon.fit());
    }
    return () => {
      sessionGeneration.current++;
      stopRef.current?.();
      progressChannelRef.current?.close();
      progressChannelRef.current = null;
      stopObserving?.();
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (manifestReady) void start();
  }, [manifestReady]);

  const selectedEnvironment = environments.find((item) => item.id === environmentId);
  const compatibility = environmentId === "shell" && !selectedEnvironment?.bytes;

  return (
    <div className="page-container container-shell">
      <div className="page-toolbar">
        <button className="button button-ghost" onClick={onBack}><ArrowLeft size={15} />{t("stage.back")}</button>
        <div className="toolbar-actions">
          <label className="container-environment-select" htmlFor="container-environment">
            <span className="muted">{t("container.environment")}</span>
            <select id="container-environment" value={environmentId} onChange={(event) => {
              const next = event.target.value as ContainerEnvironment["id"];
              setEnvironmentId(next);
              void start(next);
            }}>
              {environments.map((item) => {
                const available = item.id === "shell" || item.bytes > 0;
                return <option key={item.id} value={item.id} disabled={!available}>{item.name}{available ? "" : t("container.artifactPending")}</option>;
              })}
            </select>
          </label>
          <button className="button button-secondary" onClick={() => void start()}><RotateCcw size={14} />{t("terminal.restart")}</button>
        </div>
      </div>
      <section className="compact-hero terminal-hero">
        <span className="eyebrow"><span className="status-dot" />{t("container.eyebrow")}</span>
        <h1><TerminalIcon size={34} />{t("container.title")}<span className="gradient-text">.</span></h1>
        <p>{t("container.subtitle")}</p>
        <div className="terminal-meta"><span className="tag lang">{selectedEnvironment?.image ?? environmentId}</span><span>{compatibility ? t("container.compatibility") : selectedEnvironment?.name}</span></div>
      </section>
      <TerminalFrame hostRef={host} title={t("container.title")} />
      {progress && <ContainerStartupProgress progress={progress} />}
    </div>
  );
}
