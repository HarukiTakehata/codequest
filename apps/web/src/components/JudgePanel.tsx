import { useState } from "react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import type { JudgeResult, TestResult } from "@codequest/judge";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n";

interface Props {
  result: JudgeResult | null;
  lastRun: { stdout: string; stderr: string; exitCode: number } | null;
}

const REASON_KEYS: Record<TestResult["reason"], MessageKey> = {
  ok: "judge.passed",
  output: "judge.reason.output",
  stderr: "judge.reason.stderr",
  timeout: "judge.reason.timeout",
  missing: "judge.reason.missing",
};

export function JudgePanel({ result, lastRun }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!result && !lastRun) return <div className="judge-panel empty-judge">{t("judge.empty")}</div>;
  const failure = result?.firstFailure;
  return (
    <div className="judge-panel">
      {lastRun && (
        <section>
          <h4>{t("judge.lastRun")}<span className={lastRun.exitCode === 0 ? "tag ok" : "tag bad"}>exit {lastRun.exitCode}</span></h4>
          <pre className="output">{lastRun.stdout || t("judge.noOutput")}</pre>
          {lastRun.stderr && <pre className="output error">{lastRun.stderr}</pre>}
        </section>
      )}
      {result && (
        <section>
          <h4>{t("judge.result")}<span className={result.passed ? "tag ok" : "tag bad"}>
            {result.passed ? t("judge.passed") : t("judge.failed", { score: result.score })}
          </span></h4>
          <ul className="cases">
            {result.results.map((test) => (
              <li key={test.id} className={test.passed ? "pass" : "fail"}>
                <span className={test.passed ? "icon-text pass" : "icon-text fail"}>
                  {test.passed ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                </span>{test.name}
                {test.reason !== "ok" && <small>{t(REASON_KEYS[test.reason])}</small>}
              </li>
            ))}
          </ul>
          {failure && (
            <button className="link diff-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? t("judge.collapse") : t("judge.expandDiff")}
              {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
          )}
          {expanded && failure && (
            <div className="diff">
              <div><strong>{t("judge.expected")}</strong><pre>{failure.expected}</pre></div>
              <div><strong>{t("judge.actual")}</strong><pre>{failure.actual}</pre></div>
              <table>
                <thead><tr><th>{t("judge.line")}</th><th>{t("judge.expectedShort")}</th><th>{t("judge.actualShort")}</th></tr></thead>
                <tbody>
                  {failure.diff.map((line) => (
                    <tr key={line.line}><td>{line.line}</td><td>{line.expected}</td><td>{line.actual}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
