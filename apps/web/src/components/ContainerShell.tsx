import { useEffect, useRef, useState } from "react";
import { RotateCcw, Terminal } from "lucide-react";
import { openShellSession, type ShellSessionLike } from "@codequest/runtime-shell/src/session-client";

interface Props { onBack: () => void }

/** 独立 Container Shell：cq-minimal:cn 根文件系统快照 + wasi-sh 常驻 busybox ash 会话。 */
export function ContainerShell({ onBack }: Props) {
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<string[]>(["正在载入 cq-minimal:cn 根文件系统快照…"]);
  const [ready, setReady] = useState(false);
  const [applets, setApplets] = useState<string[]>([]);
  const session = useRef<ShellSessionLike | null>(null);
  const snapshot = useRef<Record<string, string>>({});
  const decoder = new TextDecoder();

  const start = async () => {
    session.current?.terminate();
    setReady(false);
    setLines((prev) => [...prev, "[正在启动新的 shell 会话…]"]);
    const engine = await openShellSession(snapshot.current);
    session.current = engine;
    engine.onOutput((bytes: Uint8Array) => {
      const text = decoder.decode(bytes);
      setLines((prev) => [...prev.slice(-400), ...text.replace(/\n$/, "").split("\n")]);
    });
    void engine.exited.then((code) => {
      setLines((prev) => [...prev, `[会话结束: ${code}]`]);
      setReady(false);
    });
    setReady(true);
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch("/container-shell/rootfs.json").then((r) => r.json() as Promise<Record<string, string>>),
      fetch("/container-shell/applets.json").then((r) => r.json() as Promise<string[]>),
    ]).then(([files, list]) => {
      if (!alive) return;
      snapshot.current = files;
      setApplets(list);
      void start().then(() => {
        if (!alive) return;
        setLines((prev) => [
          ...prev,
          `rootfs 快照: ${Object.keys(files).length} 个文件 / ${list.length} 个 applet`,
          "busybox 1.38 · vi 可用（:wq 保存，:q! 退出）· 支持管道与重定向",
          "输入 help 查看提示，输入 reset 重启会话。",
        ]);
      });
    }).catch((error) => {
      if (alive) setLines([`快照载入失败: ${String(error)}`]);
    });
    return () => { alive = false; session.current?.terminate(); };
    // 仅挂载时启动会话；reset 由按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const execute = () => {
    const command = input.trim();
    if (!command || !ready || !session.current) return;
    setInput("");
    if (command === "reset") { void start(); return; }
    if (command === "clear") { setLines([]); return; }
    setLines((prev) => [...prev, `$ ${command}`]);
    session.current.write(`${command}\n`);
  };

  return (
    <div className="course-list container-shell">
      <header>
        <h1 className="icon-text"><Terminal size={22} /> Container Shell</h1>
        <div className="icon-text">
          <span className="muted">cq-minimal:cn · busybox 1.38 · {applets.length} applets</span>
          <button className="ghost" onClick={() => void start()}><RotateCcw size={14} /> 重启会话</button>
          <button className="ghost" onClick={onBack}>返回课程列表</button>
        </div>
      </header>
      <p className="muted">独立容器终端：基于最小镜像根文件系统快照，常驻会话在浏览器 Worker 内运行真实 busybox；不进入剧情、不做判题。</p>
      <div className="terminal-shell-window">
        <pre className="terminal-output">{lines.join("\n")}</pre>
        <div className="terminal-input">
          <span>$</span>
          <input
            value={input} autoFocus spellCheck={false} disabled={!ready}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") execute(); }}
            placeholder={ready ? "输入命令后回车" : "会话启动中…"}
          />
          <button onClick={execute} disabled={!ready}>执行</button>
        </div>
      </div>
    </div>
  );
}
