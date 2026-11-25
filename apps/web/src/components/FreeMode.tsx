import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Play, Plus } from "lucide-react";
import { judge, type DiffMode, type JudgeResult } from "@codequest/judge";
import { freeform } from "../api";
import { buildFreeJudgeConfig, DEFAULT_FREE_TESTCASES, type FreeTestCase } from "../free";
import { runCode, type ExtendedRun } from "../runners";
import { LANG_IDS } from "../editor";
import { CodeEditor } from "./CodeEditor";
import { JudgePanel } from "./JudgePanel";

type Lang = "javascript" | "python" | "cpp" | "shell" | "java";
const LANGS: { id: Lang; label: string }[] = [
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C / C++" },
  { id: "shell", label: "Shell" },
];
const MODES: DiffMode[] = ["eol", "exact", "ws", "regex-line", "numeric-tol"];

interface Props { onBack: () => void }

/** 自由模式：不选剧情、不做变量门控，直接写任意语言代码并自定义测试点。 */
export function FreeMode({ onBack }: Props) {
  const [lang, setLang] = useState<Lang>("javascript");
  const [code, setCode] = useState("");
  const [stdin, setStdin] = useState("");
  const [cases, setCases] = useState<FreeTestCase[]>([]);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [lastRun, setLastRun] = useState<ExtendedRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState<{ line: number; message: string }[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    void freeform.get(lang).then(({ draft }) => {
      if (!alive) return;
      setCode(draft.code);
      setStdin(draft.stdin);
      setCases(draft.testcases.length ? draft.testcases : DEFAULT_FREE_TESTCASES);
      setResult(null); setLastRun(null); setDiagnostics([]);
      loaded.current = true;
    }).catch((error) => setMessage(String(error)));
    return () => { alive = false; };
  }, [lang]);

  const save = async () => {
    setBusy(true);
    try {
      await freeform.save(lang, { code, stdin, testcases: cases });
      setMessage("草稿已保存到云端");
    } catch (error) { setMessage(`保存失败: ${String(error)}`); }
    setBusy(false);
  };

  const doRun = async () => {
    setBusy(true);
    const response = await runCode(lang, { lang, code, stdin, files: {}, timeoutMs: 15_000 });
    setLastRun(response);
    updateDiagnostics(response.stderr);
    setBusy(false);
  };

  const doSubmit = async () => {
    if (!cases.length) { setMessage("请至少添加一个测试点"); return; }
    setBusy(true);
    const verdict = await judge(
      (caseStdin) => runCode(lang, { lang, code, stdin: caseStdin, files: {}, timeoutMs: 15_000 }),
      buildFreeJudgeConfig(cases),
      15_000,
    );
    setResult(verdict);
    updateDiagnostics(verdict.firstFailure?.stderr ?? "");
    setBusy(false);
    void freeform.save(lang, { code, stdin, testcases: cases }).catch(() => undefined);
  };

  const updateDiagnostics = (stderr: string) => {
    if (!stderr || (lang !== "cpp" && lang !== "java")) { setDiagnostics([]); return; }
    const pattern = lang === "cpp" ? /main\.(?:cpp|c):(\d+):\d+:\s*(.*)/g : /[^\n:]+:(\d+):\s*([^\n]+)/g;
    const markers = [...stderr.matchAll(pattern)]
      .map((m) => ({ line: Number(m[1]), message: String(m[2]).trim() }));
    setDiagnostics(markers.length ? markers : [{ line: 1, message: stderr.trim() }]);
  };

  const patchCase = (index: number, patch: Partial<FreeTestCase>) =>
    setCases((prev) => prev.map((test, i) => i === index ? { ...test, ...patch } : test));

  return (
    <div className="course-list free-mode">
      <header>
        <h1>自由模式</h1>
        <button className="ghost" onClick={onBack}><ArrowLeft size={15} /> 课程列表</button>
      </header>
      <p className="muted">任意语言自由写代码、自定义输入输出测试点。草稿登录后按语言自动云端保存，不依赖剧情进度。</p>
      <div className="lang-tabs">
        {LANGS.map((item) => (
          <button key={item.id} className={item.id === lang ? "active" : ""}
            onClick={() => setLang(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="free-grid">
        <section>
          <h3>代码 <small className="muted">[{LANG_IDS[lang]}]</small></h3>
          <div className="editor-wrap">
            <CodeEditor value={code} language={lang} onChange={setCode} diagnostics={diagnostics} />
          </div>
          <div className="controls">
            <button onClick={() => void doRun()} disabled={busy || !loaded.current}>
              <span className="icon-text"><Play size={15} /> 运行</span>
            </button>
            <button className="primary" onClick={() => void doSubmit()} disabled={busy || !loaded.current}>提交判定</button>
            <button className="ghost" onClick={() => void save()} disabled={busy}>保存草稿</button>
          </div>
          <label className="stdin-row">运行时 stdin（自定义）
            <textarea value={stdin} rows={2} spellCheck={false} onChange={(e) => setStdin(e.target.value)} />
          </label>
          {message && <p className="muted">{message}</p>}
          <JudgePanel result={result} lastRun={lastRun} />
        </section>
        <aside className="free-cases">
          <h3>测试点</h3>
          {cases.map((test, index) => (
            <div className="case-card" key={test.id}>
              <div className="case-head">
                <input value={test.name} onChange={(e) => patchCase(index, { name: e.target.value })} aria-label="测试点名称" />
                <button className="ghost" onClick={() => setCases((prev) => prev.filter((_, i) => i !== index))}>删除</button>
              </div>
              <label>stdin<textarea rows={2} spellCheck={false} value={test.stdin}
                onChange={(e) => patchCase(index, { stdin: e.target.value })} /></label>
              <label>expected<textarea rows={2} spellCheck={false} value={test.expected}
                onChange={(e) => patchCase(index, { expected: e.target.value })} /></label>
              <label>比对模式
                <select value={test.mode} onChange={(e) => patchCase(index, { mode: e.target.value as DiffMode })}>
                  {MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
              </label>
            </div>
          ))}
          <button onClick={() => setCases((prev) => [...prev, {
            id: `t${prev.length + 1}`, name: `测试点 ${prev.length + 1}`, stdin: "", expected: "", mode: "eol",
          }])}><span className="icon-text"><Plus size={15} /> 添加测试点</span></button>
        </aside>
      </div>
    </div>
  );
}

