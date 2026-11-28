import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { evaluateGoals, type GoalStatus, type RunResponse } from "@codequest/judge";
import { runScript } from "@codequest/rpgjs-script/client";
import { describeCourseApi } from "@codequest/rpgjs-script/editor";
import type {
  CourseApiDescription,
  JudgeScriptInput,
  ScriptJudgeCase,
  ScriptJudgeReport,
  ScriptRunSpec,
  ScriptSimulationResult,
  ScriptWorkerRequest,
} from "@codequest/rpgjs-script";
import { CodeEditor } from "./CodeEditor";
import { GoalPanel } from "./GoalPanel";
import { JudgePanel } from "./JudgePanel";
import { useI18n } from "../i18n/I18nProvider";
import type { Challenge } from "../types";
import {
  adaptScriptDiagnostics,
  adaptScriptJudgeResult,
  adaptScriptRunResult,
  applyScriptJudgeAttempt,
  createScriptAttemptState,
  type ScriptAttemptState,
  type ScriptDiagnostic,
  type ScriptEffect,
  type ScriptPassPayload,
  type ScriptWorkbenchViewModel,
} from "../script-workbench";

export interface ScriptWorkbenchProps {
  challenge: Challenge;
  /** Declaration source only. The Worker uses the package's matching course implementation. */
  api?: CourseApiDescription;
  run: ScriptRunSpec;
  tests: ScriptJudgeCase[];
  judgeOptions?: Omit<JudgeScriptInput, "source" | "cases">;
  timeoutMs?: number;
  /** Optional precomputed declaration; otherwise it comes from the shared API description. */
  apiDeclaration?: string;
  onPass: (payload: ScriptPassPayload) => void;
  onClose: () => void;
}

type WorkerOperation = "check" | "run" | "judge";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function structuredDetails(
  state: unknown,
  effects: ScriptEffect[],
  details: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...details,
    ...(state !== undefined ? { state } : {}),
    ...(effects.length > 0 ? { effects } : {}),
  };
}

function formatDetails(value: Record<string, unknown>): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function firstSimulation(report: ScriptJudgeReport): ScriptSimulationResult | ScriptJudgeReport {
  return report.results[0]?.result ?? report;
}

export function ScriptWorkbench({
  challenge,
  api,
  run: runSpec,
  tests,
  judgeOptions,
  timeoutMs,
  apiDeclaration,
  onPass,
  onClose,
}: ScriptWorkbenchProps) {
  const { t } = useI18n();
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;
  const [code, setCode] = useState(challenge.template);
  const [diagnostics, setDiagnostics] = useState<ScriptDiagnostic[]>([]);
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);
  const [model, setModel] = useState<ScriptWorkbenchViewModel | null>(null);
  const [state, setState] = useState<unknown>(undefined);
  const [effects, setEffects] = useState<ScriptEffect[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<WorkerOperation | null>(null);
  const attemptRef = useRef<ScriptAttemptState>(createScriptAttemptState(challenge.id));
  const mountedRef = useRef(false);
  const requestSequence = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiDeclarationText = useMemo(
    () => apiDeclaration ?? describeCourseApi(api),
    [api, apiDeclaration],
  );

  const workerRequest = useCallback((source: string, cases: ScriptJudgeCase[]): ScriptWorkerRequest => ({
    ...judgeOptions,
    source,
    cases,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  }), [judgeOptions, timeoutMs]);

  const beginRequest = useCallback((): AbortController => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequence.current++;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    requestSequence.current++;
    abortRef.current?.abort();
    attemptRef.current = createScriptAttemptState(challenge.id);
    setCode(challenge.template);
    setDiagnostics([]);
    setLastRun(null);
    setModel(null);
    setState(undefined);
    setEffects([]);
    setError("");
  }, [challenge.id, challenge.template]);

  useEffect(() => {
    if (busy) return;
    if (!code.trim()) {
      setDiagnostics([]);
      return;
    }
    const timer = setTimeout(() => {
      const requestId = ++requestSequence.current;
      const controller = beginRequest();
      void (async () => {
        try {
          // An empty case set still parses/compiles in the Worker, without executing user code.
          const response = await runScript(workerRequest(code, []), { signal: controller.signal });
          if (!mountedRef.current || requestId !== requestSequence.current) return;
          setDiagnostics(adaptScriptDiagnostics(response));
        } catch (cause) {
          if (!mountedRef.current || requestId !== requestSequence.current) return;
          setDiagnostics([{ line: 1, message: errorMessage(cause), severity: "error" }]);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [code, workerRequest, busy]);

  const doRun = async () => {
    if (busy) return;
    const requestId = ++requestSequence.current;
    const controller = beginRequest();
    setBusy("run");
    setError("");
    try {
      const report = await runScript(workerRequest(code, [{
        ...runSpec,
        name: "Run",
        expect: {},
      }]), { signal: controller.signal });
      if (!mountedRef.current || requestId !== requestSequence.current) return;
      const result = adaptScriptRunResult(firstSimulation(report));
      setLastRun(result.run);
      setDiagnostics(result.diagnostics);
      setState(result.state);
      setEffects(result.effects);
      setModel(null);
    } catch (cause) {
      if (!mountedRef.current || requestId !== requestSequence.current) return;
      setError(errorMessage(cause));
    } finally {
      if (mountedRef.current && requestId === requestSequence.current) setBusy(null);
    }
  };

  const doSubmit = async () => {
    if (busy || tests.length === 0 || !goalsSatisfied) return;
    const requestId = ++requestSequence.current;
    const controller = beginRequest();
    setBusy("judge");
    setError("");
    try {
      const response = await runScript(workerRequest(code, tests), { signal: controller.signal });
      if (!mountedRef.current || requestId !== requestSequence.current) return;
      const result = adaptScriptJudgeResult(response, { source: code, goals: challenge.goals });
      setModel(result);
      setLastRun(result.run);
      setDiagnostics(result.diagnostics);
      setState(result.state);
      setEffects(result.effects);
      const transition = applyScriptJudgeAttempt(attemptRef.current, result, {
        challengeId: challenge.id,
        code,
      });
      attemptRef.current = transition.state;
      if (transition.onPass) onPassRef.current(transition.onPass);
    } catch (cause) {
      if (!mountedRef.current || requestId !== requestSequence.current) return;
      setError(errorMessage(cause));
    } finally {
      if (mountedRef.current && requestId === requestSequence.current) setBusy(null);
    }
  };

  const goals: GoalStatus[] = model?.goals ?? evaluateGoals(challenge.goals, {
    source: code,
    lastRun,
    files: {},
    testResults: [],
  });
  const allDone = goals.length === 0 || goals.every((goal) => goal.done);
  const goalsSatisfied = !challenge.requireAllGoals || allDone;
  const notices = diagnostics.filter((item) => item.severity !== "error");
  const details = structuredDetails(state, effects, model?.details ?? {});
  const disabled = busy !== null;

  return (
    <div className="workbench">
      <header>
        <div>
          <span className="tag lang">javascript</span><strong>{challenge.title}</strong>
        </div>
        <button className="button button-ghost" onClick={onClose}>{t("workbench.backToStory")}</button>
      </header>
      <div className="workbench-body">
        <div className="workbench-main">
          <p className="prompt" dangerouslySetInnerHTML={{ __html: challenge.description.replace(/\n/g, "<br/>") }} />
          <div className="editor-wrap">
            <CodeEditor
              value={code}
              language="javascript"
              onChange={(next) => {
                requestSequence.current++;
                abortRef.current?.abort();
                setCode(next);
                setModel(null);
                setState(undefined);
                setEffects([]);
              }}
              diagnostics={diagnostics.filter((item) => item.severity === "error")}
              apiDeclaration={apiDeclarationText}
            />
          </div>
          {notices.length > 0 && (
            <pre className="output">{notices.map((item) => `${item.line}: ${item.message}`).join("\n")}</pre>
          )}
          <div className="controls">
            <button className="button button-secondary" onClick={() => void doRun()} disabled={disabled}>
              {busy === "run" ? t("workbench.running") : <span className="icon-text"><Play size={15} />{t("workbench.run")}</span>}
            </button>
            <button className="button button-primary" onClick={() => void doSubmit()} disabled={disabled || tests.length === 0 || !goalsSatisfied}>
              {busy === "judge" ? t("workbench.running") : t("workbench.submit")}
            </button>
          </div>
          {error && <p className="bad" role="alert">{error}</p>}
          <JudgePanel result={model?.verdict ?? null} lastRun={lastRun} />
          {Object.keys(details).length > 0 && (
            <details className="script-workbench-details">
              <summary>{t("judge.result")}</summary>
              <pre className="output">{formatDetails(details)}</pre>
            </details>
          )}
        </div>
        <GoalPanel goals={goals} allDone={allDone} required={challenge.requireAllGoals} />
      </div>
    </div>
  );
}
