import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Code2, FlaskConical, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { judge, type DiffMode, type JudgeResult } from "@codequest/judge";
import { openAutomatedContainerSession, type AutomatedContainerSession } from "@codequest/runtime-shell/src/container-runtime";
import { freeform } from "../api";
import { buildFreeJudgeConfig, DEFAULT_FREE_TESTCASES, isFactoryFreeSample, type FreeTestCase } from "../free";
import { runCode, type ExtendedRun } from "../runners";
import { LANG_IDS } from "../editor";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n/I18nProvider";
import { CodeEditor } from "./CodeEditor";
import { JudgePanel } from "./JudgePanel";
import { ContainerStartupProgress, type ContainerStartupProgressState } from "./ContainerStartupProgress";

type Lang = "javascript" | "python" | "cpp" | "shell" | "java";
const LANGS: { id: Lang; label: string }[] = [
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C / C++" },
  { id: "shell", label: "Shell" },
];
const MODES: DiffMode[] = ["eol", "exact", "ws", "regex-line", "numeric-tol"];
const MODE_KEYS: Record<DiffMode, MessageKey> = {
  eol: "mode.eol", exact: "mode.exact", ws: "mode.ws", "regex-line": "mode.regex-line", "numeric-tol": "mode.numeric-tol",
};

interface Props { onBack: () => void }

/** 自由模式：Shell 进入即启动常驻真实容器，运行/判题复用同一会话，退出销毁。 */
export function FreeMode({ onBack }: Props) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [lang, setLang] = useState<Lang>("javascript");
  const [code, setCode] = useState("");
  const [stdin, setStdin] = useState("");
  const [cases, setCases] = useState<FreeTestCase[]>([]);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [lastRun, setLastRun] = useState<ExtendedRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ line: number; message: string }[]>([]);
  const [loadedLang, setLoadedLang] = useState<Lang | null>(null);
  const [progress, setProgress] = useState<ContainerStartupProgressState | null>(null);
  const [containerReady, setContainerReady] = useState(false);
  const shellSessionRef = useRef<AutomatedContainerSession | null>(null);
  const progressChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionGeneration = useRef(0);

  const closeShellSession = useCallback(() => {
    sessionGeneration.current++;
    shellSessionRef.current?.close();
    shellSessionRef.current = null;
    progressChannelRef.current?.close();
    progressChannelRef.current = null;
    setContainerReady(false);
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
        if (next.requestId && next.requestId !== "shell-free") return;
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
      session = await openAutomatedContainerSession({}, { requestId: "shell-free" });
      if (generation !== sessionGeneration.current) { session.close(); return; }
      const ready = await session.run({
        lang: "shell",
        code: "printf '__CQ_SESSION_READY__\\n'",
        stdin: "",
        files: {},
        timeoutMs: 10_000,
      });
      if (ready.exitCode !== 0 || !ready.stdout.includes("__CQ_SESSION_READY__")) {
        throw new Error(ready.stderr || tRef.current("free.containerNotReady"));
      }
      if (generation !== sessionGeneration.current) { session.close(); return; }
      shellSessionRef.current = session;
      setContainerReady(true);
      setProgress(null);
    } catch (error) {
      session?.close();
      if (generation !== sessionGeneration.current) return;
      setProgress({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [closeShellSession]);

  useEffect(() => {
    if (lang !== "shell") { closeShellSession(); return; }
    void startShellContainer();
    return closeShellSession;
  }, [lang, startShellContainer, closeShellSession]);

  useEffect(() => {
    let alive = true;
    setLoadedLang(null);
    setCode(""); setStdin(""); setCases([]); setResult(null); setLastRun(null); setDiagnostics([]); setMessage(null);
    void freeform.get(lang).then(({ draft }) => {
      if (!alive) return;
      setCode(draft.code);
      setStdin(draft.stdin);
      const initialCases = draft.testcases.length ? draft.testcases : DEFAULT_FREE_TESTCASES;
      setCases(draft.updated_at ? initialCases : initialCases.map((test) => (
        isFactoryFreeSample(test) ? { ...test, name: tRef.current("free.sample") } : test
      )));
      setLoadedLang(lang);
    }).catch(() => { if (alive) setMessage("errors.network"); });
    return () => { alive = false; };
  }, [lang]);

  const selectLanguage = (next: Lang) => {
    if (next === lang) return;
    setLoadedLang(null);
    setCode(""); setStdin(""); setCases([]); setResult(null); setLastRun(null); setDiagnostics([]); setMessage(null);
    setLang(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      await freeform.save(lang, { code, stdin, testcases: cases });
      setMessage("free.draftSaved");
    } catch { setMessage("free.saveFailed"); }
    finally { setBusy(false); }
  };

  const runShellRequest = (script: string, caseStdin: string) => {
    const session = shellSessionRef.current;
    if (!session) throw new Error(tRef.current("free.containerNotReady"));
    return session.run({ lang: "shell", code: script, stdin: caseStdin, files: {}, timeoutMs: 14_000 });
  };

  const doRun = async () => {
    setBusy(true); setMessage(null);
    try {
      const response = lang === "shell"
        ? await runShellRequest(code, stdin)
        : await runCode(lang, { lang, code, stdin, files: {}, timeoutMs: 15_000 });
      setLastRun(response);
      updateDiagnostics(response.stderr);
    } catch { setMessage("errors.runtime"); }
    finally { setBusy(false); }
  };

  const doSubmit = async () => {
    if (!cases.length) { setMessage("free.needCase"); return; }
    setBusy(true); setMessage(null);
    try {
      const verdict = await judge(
        (caseStdin) => lang === "shell"
          ? runShellRequest(code, caseStdin)
          : runCode(lang, { lang, code, stdin: caseStdin, files: {}, timeoutMs: 15_000 }),
        buildFreeJudgeConfig(cases),
        15_000,
      );
      setResult(verdict);
      updateDiagnostics(verdict.firstFailure?.stderr ?? "");
      void freeform.save(lang, { code, stdin, testcases: cases }).catch(() => undefined);
    } catch { setMessage("errors.runtime"); }
    finally { setBusy(false); }
  };

  const updateDiagnostics = (stderr: string) => {
    if (!stderr || (lang !== "cpp" && lang !== "java")) { setDiagnostics([]); return; }
    const pattern = lang === "cpp" ? /main\.(?:cpp|c):(\d+):\d+:\s*(.*)/g : /[^\n:]+:(\d+):\s*(.+)/g;
    const markers = [...stderr.matchAll(pattern)]
      .map((m) => ({ line: Number(m[1]), message: String(m[2]).trim() }));
    setDiagnostics(markers.length ? markers : [{ line: 1, message: stderr.trim() }]);
  };

  const patchCase = (index: number, patch: Partial<FreeTestCase>) =>
    setCases((prev) => prev.map((test, i) => i === index ? { ...test, ...patch } : test));

  const disabled = busy || loadedLang !== lang || (lang === "shell" && !containerReady);
  return (
    <div className="page-container free-mode">
      <div className="page-toolbar">
        <button className="button button-ghost" onClick={onBack}><ArrowLeft size={15} />{t("stage.back")}</button>
        <span className="count-badge"><FlaskConical size={14} />{LANGS.find((item) => item.id === lang)?.label}</span>
      </div>
      <section className="compact-hero">
        <span className="eyebrow"><span className="status-dot" />{t("free.eyebrow")}</span>
        <h1>{t("free.title")}<span className="gradient-text">.</span></h1>
        <p>{t("free.subtitle")}</p>
      </section>
      <div className="workspace-card">
        <div className="workspace-toolbar">
          <div className="lang-tabs" role="tablist" aria-label={t("free.title")}>
            {LANGS.map((item) => (
              <button key={item.id} role="tab" aria-selected={item.id === lang} className={item.id === lang ? "active" : ""}
                disabled={busy} onClick={() => selectLanguage(item.id)}>{item.label}</button>
            ))}
          </div>
          <span className="workspace-language"><Code2 size={14} />{LANG_IDS[lang]}</span>
        </div>
        <div className="free-grid">
          <section className="editor-panel">
            <div className="panel-heading"><h2>{t("free.code")}</h2><span>.{LANG_IDS[lang]}</span></div>
            <div className="editor-wrap editor-wrap-large">
              <CodeEditor value={code} language={lang} onChange={setCode} diagnostics={diagnostics} />
            </div>
            <div className="controls">
              <button className="button button-secondary" onClick={() => void doRun()} disabled={disabled}><Play size={15} />{busy ? t("workbench.running") : t("workbench.run")}</button>
              <button className="button button-primary" onClick={() => void doSubmit()} disabled={disabled}>{t("workbench.submit")}<ArrowUpRight size={15} /></button>
              <button className="button button-ghost" onClick={() => void save()} disabled={busy || loadedLang !== lang}><Save size={15} />{t("free.saveDraft")}</button>
              {lang === "shell" && <button className="button button-ghost" onClick={() => void startShellContainer()} disabled={busy}><RotateCcw size={14} />{t("workbench.resetContainer")}</button>}
            </div>
            <label className="stdin-row">{t("free.stdin")}
              <textarea value={stdin} rows={3} spellCheck={false} onChange={(e) => setStdin(e.target.value)} />
            </label>
            {message && <p className={`workspace-message ${message === "free.draftSaved" ? "is-success" : "is-error"}`} role="status">{t(message)}</p>}
            <JudgePanel result={result} lastRun={lastRun} />
          </section>
          <aside className="free-cases">
            <div className="panel-heading"><h2>{t("free.testcases")}</h2><span className="count-badge">{cases.length}</span></div>
            <div className="case-list">
              {cases.map((test, index) => (
                <div className="case-card" key={test.id}>
                  <div className="case-head">
                    <span className="case-number">{String(index + 1).padStart(2, "0")}</span>
                    <input className="field" value={test.name} onChange={(e) => patchCase(index, { name: e.target.value })} aria-label={t("free.caseName")} />
                    <button className="icon-button delete-case" onClick={() => setCases((prev) => prev.filter((_, i) => i !== index))} aria-label={`${t("common.delete")}: ${test.name}`} title={t("common.delete")}><Trash2 size={15} /></button>
                  </div>
                  <label>stdin<textarea rows={2} value={test.stdin} spellCheck={false}
                    onChange={(e) => patchCase(index, { stdin: e.target.value })} /></label>
                  <label>{t("free.expected")}<textarea rows={2} value={test.expected} spellCheck={false}
                    onChange={(e) => patchCase(index, { expected: e.target.value })} /></label>
                  <label>{t("free.compareMode")}
                    <select value={test.mode} onChange={(e) => patchCase(index, { mode: e.target.value as DiffMode })}>
                      {MODES.map((mode) => <option key={mode} value={mode}>{t(MODE_KEYS[mode])}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            {cases.length === 0 && <div className="empty-cases"><FlaskConical size={24} /><p>{t("free.needCase")}</p></div>}
            <button className="button button-outline add-case" onClick={() => setCases((prev) => [...prev, {
              id: `t${prev.length + 1}`, name: t("free.caseDefaultName", { number: prev.length + 1 }), stdin: "", expected: "", mode: "eol",
            }])}><Plus size={15} />{t("free.addCase")}</button>
          </aside>
        </div>
      </div>
      {lang === "shell" && progress && <ContainerStartupProgress progress={progress} />}
    </div>
  );
}
