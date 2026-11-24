import { useEffect, useState } from "react";
import { evaluateGoals, judge, type GoalStatus, type JudgeResult, type RunResponse } from "@codequest/judge";
import { runCode, type ExtendedRun } from "../runners";
import type { Challenge, JudgeConfig } from "../types";
import { CodeEditor } from "./CodeEditor";
import { GoalPanel } from "./GoalPanel";
import { JudgePanel } from "./JudgePanel";

interface Props {
  challenge: Challenge;
  judgeConfig: JudgeConfig | null;
  onPass: (payload: { score: number; code: string; files: Record<string, string> }) => void;
  onClose: () => void;
}

export function Workbench({ challenge, judgeConfig, onPass, onClose }: Props) {
  const [code, setCode] = useState(challenge.template);
  const [stdin, setStdin] = useState(judgeConfig?.cases[0]?.stdin ?? "");
  const [lastRun, setLastRun] = useState<ExtendedRun | null>(null);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [files, setFiles] = useState<Record<string, string>>(challenge.presetFiles);
  const [goals, setGoals] = useState<GoalStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ line: number; message: string }[]>([]);

  useEffect(() => {
    setCode(challenge.template);
    setStdin(judgeConfig?.cases[0]?.stdin ?? "");
    setLastRun(null); setResult(null); setFiles(challenge.presetFiles); setDiagnostics([]);
  }, [challenge, judgeConfig]);

  useEffect(() => {
    const timer = setTimeout(() => setGoals(evaluateGoals(challenge.goals, {
      source: code, lastRun, files, testResults: result?.results ?? [],
    })), 300);
    return () => clearTimeout(timer);
  }, [code, lastRun, files, result, challenge.goals]);

  const allDone = goals.length === 0 || goals.every((g) => g.done);
  const baseFiles = challenge.lang === "shell" ? files : challenge.presetFiles;

  const doRun = async () => {
    setBusy(true);
    const response = await runCode(challenge.lang, {
      lang: challenge.lang, code, stdin, files: baseFiles, timeoutMs: 10_000,
    });
    setLastRun(response);
    if (response.files) setFiles(response.files);
    if (challenge.lang === "cpp" && response.stderr) {
      const markers = [...response.stderr.matchAll(/(?:^|\n)[^\n]*?:(\d+):(\d+)?:\s*(.*)/g)]
        .map((m) => ({ line: Number(m[1]), message: m[3] ?? m[0] }));
      setDiagnostics(markers.length ? markers : [{ line: 1, message: response.stderr.trim() }]);
    }
    setBusy(false);
  };

  const doSubmit = async () => {
    if (!judgeConfig) return;
    setBusy(true);
    const verdict = await judge((caseStdin) => runCode(challenge.lang, {
      lang: challenge.lang, code, stdin: caseStdin, files: baseFiles, timeoutMs: 10_000,
    }), judgeConfig, 10_000);
    setResult(verdict);
    setBusy(false);
    if (verdict.passed) onPass({ score: verdict.score, code, files });
  };

  const run: RunResponse | null = lastRun;
  return (
    <div className="workbench">
      <header>
        <div>
          <span className="tag lang">{challenge.lang}</span>
          <strong>{challenge.title}</strong>
        </div>
        <button className="ghost" onClick={onClose}>返回剧情</button>
      </header>
      <div className="workbench-body">
        <div className="workbench-main">
          <div className="prompt" dangerouslySetInnerHTML={{ __html: challenge.description.replace(/\n/g, "<br/>") }} />
          <div className="editor-wrap">
            <CodeEditor value={code} language={challenge.lang} onChange={setCode} diagnostics={diagnostics} />
          </div>
          <div className="stdin-row">
            <label>stdin（运行测试）</label>
            <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} rows={2} spellCheck={false} />
          </div>
          <div className="controls">
            <button onClick={doRun} disabled={busy}>{busy ? "运行中…" : "▶ 运行"}</button>
            <button className="primary" onClick={doSubmit} disabled={busy || !judgeConfig || !allDone}>
              {busy ? "判题中…" : "提交判定"}
            </button>
          </div>
          <JudgePanel result={result} lastRun={run} />
        </div>
        <GoalPanel goals={goals} allDone={allDone} required={challenge.requireAllGoals} />
      </div>
    </div>
  );
}
