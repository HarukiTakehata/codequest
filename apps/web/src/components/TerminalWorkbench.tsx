import { useState } from "react";
import { runShell } from "@codequest/runtime-shell/src/client";
import type { Challenge } from "../types";

interface Props {
  challenge: Challenge;
  onClose: () => void;
}

/** Bandit 式探索会话：命令在 Worker 内的虚拟文件系统执行（M4 容器会话的前置形态）。 */
export function TerminalWorkbench({ challenge, onClose }: Props) {
  const [files, setFiles] = useState<Record<string, string>>(challenge.presetFiles);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<string[]>([
    "CodeQuest Shell 教学环境（MVP 内存文件系统）",
    "提示：ls / cat secret.txt / grep / find 均可使用。输入 help 查看说明。",
  ]);

  const execute = async () => {
    const command = input.trim();
    if (!command) return;
    if (command === "clear") { setLines([]); setInput(""); return; }
    if (command === "help") {
      setLines((prev) => [...prev, "$ help", "可用：pwd ls cd cat echo grep head tail sort uniq wc find touch mkdir cp mv rm test stat md5sum seq tr cut | > >>"]);
      setInput(""); return;
    }
    const result = await runShell({ lang: "shell", code: command, stdin: "", files, timeoutMs: 5000 });
    setFiles(result.files);
    setLines((prev) => [...prev, `$ ${command}`, ...result.stdout.replace(/\n$/, "").split("\n").filter(Boolean),
      ...result.stderr.replace(/\n$/, "").split("\n").filter(Boolean).map((line) => `! ${line}`)]);
    setInput("");
  };

  return (
    <div className="workbench terminal">
      <header>
        <div><span className="tag lang">shell</span><strong>{challenge.title}</strong></div>
        <button className="ghost" onClick={onClose}>关闭终端</button>
      </header>
      <pre className="terminal-output">{lines.join("\n")}</pre>
      <div className="terminal-input">
        <span>$</span>
        <input
          value={input} autoFocus spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void execute(); }}
          placeholder="输入命令后回车"
        />
        <button onClick={() => void execute()}>执行</button>
      </div>
    </div>
  );
}
