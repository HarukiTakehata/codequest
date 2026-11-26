import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { evaluateGoals, judge, type GoalStatus, type JudgeResult, type RunResponse } from "@codequest/judge";
import { openAutomatedContainerSession, buildContainerGoalCheckScript, parseContainerGoalChecks, type AutomatedContainerSession } from "@codequest/runtime-shell/src/container-runtime";
import { runCode, type ExtendedRun } from "../runners";
import type { Challenge, JudgeConfig } from "../types";
import { CodeEditor } from "./CodeEditor";
import { GoalPanel } from "./GoalPanel";
import { JudgePanel } from "./JudgePanel";
import { ContainerStartupProgress, type ContainerStartupProgressState } from "./ContainerStartupProgress";
import { useI18n } from "../i18n/I18nProvider";

interface Props {
  challenge: Challenge;
  judgeConfig: JudgeConfig | null;
  onPass: (payload: { score: number; code: string; files: Record<string, string> }) => void;
  onClose: () => void;
}

export function Workbench({ challenge, judgeConfig, onPass, onClose }: Props) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [code, setCode] = useState(challenge.template);
  const [stdin, setStdin] = useState(judgeConfig?.cases[0]?.stdin ?? "");
  const [lastRun, setLastRun] = useState<ExtendedRun | null>(null);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [files, setFiles] = useState<Record<string, string>>(challenge.presetFiles);
  const [goals, setGoals] = useState<GoalStatus[]>([]);
  const [runtimeGoalResults, setRuntimeGoalResults] = useState<Record<string, boolean>>({});
  const [goalError, setGoalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ line: number; message: string }[]>([]);
  const [progress, setProgress] = useState<ContainerStartupProgressState | null>(null);
  const [containerReady, setContainerReady] = useState(false);
  const shellSessionRef = useRef<AutomatedContainerSession | null>(null);
  const progressChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionGeneration = useRef(0);
  const usesContainer = challenge.lang === "shell";

  const closeShellSession = useCallback(() => {
    sessionGeneration.current++;
    shellSessionRef.current?.close();
    shellSessionRef.current = null;
    progressChannelRef.current?.close();
    progressChannelRef.current = null;
    setContainerReady(false);
    setRuntimeGoalResults({});
    setGoalError("");
  }, []);

  const startShellContainer = useCallback(async () => {
    closeShellSession();
    const generation = sessionGeneration.current;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("codequest-c2w-progress");
      channel.onmessage = (event: MessageEvent<ContainerStartupProgressState>) => {
        const next = event.data;
        if (!next || !["downloading", "starting", "error"].includes(next.phase)) return;
        if (generation !== sessionGeneration.current) return;
        if (next.requestId && next.requestId !== "shell-course") return;
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
    let session: AutomatedContainerSession | null = null;
    try {
      session = await openAutomatedContainerSession(challenge.presetFiles, { requestId: "shell-course" });
      if (generation !== sessionGeneration.current) { session.close(); return; }
      const ready = await session.run({
        lang: "shell",
        code: "printf '__CQ_SESSION_READY__\\n'",
        stdin: "",
        files: {},
        timeoutMs: 10_000,
      });
      if (ready.exitCode !== 0 || !ready.stdout.includes("__CQ_SESSION_READY__")) {
        throw new Error(ready.stderr || tRef.current("workbench.containerNotReady"));
      }
      if (generation !== sessionGeneration.current) { session.close(); return; }
      shellSessionRef.current = session;
      setContainerReady(true);
      setProgress(null);
    } catch (error) {
      session?.close();
      if (generation !== sessionGeneration.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setProgress({ phase: "error", message });
    }
  }, [challenge.presetFiles, closeShellSession]);

  useEffect(() => {
    setCode(challenge.template);
    setStdin(judgeConfig?.cases[0]?.stdin ?? "");
    setLastRun(null); setResult(null); setFiles(challenge.presetFiles); setDiagnostics([]);
    setRuntimeGoalResults({}); setGoalError("");
  }, [challenge, judgeConfig]);

  useEffect(() => {
    if (!usesContainer) return;
    void startShellContainer();
    return closeShellSession;
  }, [usesContainer, startShellContainer, closeShellSession]);

  useEffect(() => {
    const timer = setTimeout(() => setGoals(evaluateGoals(challenge.goals, {
      source: code, lastRun, files: usesContainer ? {} : files, testResults: result?.results ?? [], runtimeGoalResults,
    })), 300);
    return () => clearTimeout(timer);
  }, [code, lastRun, files, result, challenge.goals, runtimeGoalResults, usesContainer]);

  const allDone = goals.length === 0 || goals.every((g) => g.done);
  const goalsSatisfied = !challenge.requireAllGoals || allDone;

  const runShellRequest = (script: string, caseStdin: string, timeoutMs = 14_000) => {
    const session = shellSessionRef.current;
    if (!session) throw new Error(t("workbench.containerNotReady"));
    return session.run({ lang: "shell", code: script, stdin: caseStdin, files: {}, timeoutMs });
  };

  const refreshRuntimeGoals = async () => {
    if (!usesContainer) return;
    const checks = challenge.goals.filter((goal) => goal.check.kind === "file-exists" || goal.check.kind === "command-stdout");
    if (!checks.length) return;
    const response = await runShellRequest(buildContainerGoalCheckScript(checks), "", 5000);
    if (response.exitCode !== 0) throw new Error(response.stderr || t("workbench.goalCheckFailed"));
    setRuntimeGoalResults(parseContainerGoalChecks(checks, response.stdout));
    setGoalError("");
  };

  const doRun = async () => {
    setBusy(true);
    try {
      const response: ExtendedRun = usesContainer
        ? await runShellRequest(code, stdin)
        : await runCode(challenge.lang, {
          lang: challenge.lang, code, stdin, files: challenge.presetFiles, timeoutMs: 10_000,
        });
      setLastRun(response);
      if (response.files) setFiles(response.files);
      if ((challenge.lang === "cpp" || challenge.lang === "java") && response.stderr) {
        const pattern = challenge.lang === "cpp" ? /main\.(?:cpp|c):(\d+):\d+:\s*(.*)/g : /[^\n:]+:(\d+):\s*(.+)/g;
        const markers = [...response.stderr.matchAll(pattern)]
          .map((m) => ({ line: Number(m[1]), message: String(m[2] ?? m[0]).trim() }));
        setDiagnostics(markers.length ? markers : [{ line: 1, message: response.stderr.trim() }]);
      }
      if (usesContainer) {
        try { await refreshRuntimeGoals(); }
        catch (error) { setGoalError(error instanceof Error ? error.message : String(error)); }
      }
    } catch (error) {
      setLastRun({ stdout: "", stderr: String(error), exitCode: 1, logs: [] });
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async () => {
    if (!judgeConfig) return;
    setBusy(true);
    try {
      if (usesContainer) {
        try { await refreshRuntimeGoals(); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setGoalError(message);
          setLastRun({ stdout: "", stderr: message, exitCode: 1, logs: [] });
          return;
        }
      }
      const verdict = await judge(
        (caseStdin) => usesContainer
          ? runShellRequest(code, caseStdin)
          : runCode(challenge.lang, {
            lang: challenge.lang, code, stdin: caseStdin, files: challenge.presetFiles, timeoutMs: 10_000,
          }),
        judgeConfig,
        15_000,
      );
      setResult(verdict);
      if (verdict.passed) onPass({ score: verdict.score, code, files });
    } finally {
      setBusy(false);
    }
  };

  const run: RunResponse | null = lastRun;
  const disabled = busy || (usesContainer && !containerReady);
  return (
    <div className="workbench">
      <header>
        <div>
          <span className="tag lang">{challenge.lang}</span><strong>{challenge.title}</strong>
        </div>
        <div className="icon-text">
          {usesContainer && <button className="button button-ghost" onClick={() => void startShellContainer()} disabled={busy}><RotateCcw size={14} />{t("workbench.resetContainer")}</button>}
          <button className="button button-ghost" onClick={onClose}>{t("workbench.backToStory")}</button>
        </div>
      </header>
      <div className="workbench-body">
        <div className="workbench-main">
          <div className="prompt" dangerouslySetInnerHTML={{ __html: challenge.description.replace(/\n/g, "<br/>") }} />
          <div className="editor-wrap">
            <CodeEditor value={code} language={challenge.lang} onChange={setCode} diagnostics={diagnostics} />
          </div>
          <div className="stdin-row">
            <label htmlFor="workbench-stdin">{t("workbench.stdin")}</label>
            <textarea id="workbench-stdin" value={stdin} onChange={(e) => setStdin(e.target.value)} rows={2} spellCheck={false} />
          </div>
          <div className="controls">
            <button className="button button-secondary" onClick={() => void doRun()} disabled={disabled}>
              {busy ? t("workbench.running") : <span className="icon-text"><Play size={15} />{t("workbench.run")}</span>}
            </button>
            <button className="button button-primary" onClick={() => void doSubmit()} disabled={disabled || !judgeConfig || !goalsSatisfied}>{t("workbench.submit")}</button>
          </div>
          <JudgePanel result={result} lastRun={run} />
          {goalError && <p className="bad">{goalError}</p>}
        </div>
        <GoalPanel goals={goals} allDone={allDone} required={challenge.requireAllGoals} />
      </div>
      {usesContainer && progress && <ContainerStartupProgress progress={progress} />}
    </div>
  );
}
