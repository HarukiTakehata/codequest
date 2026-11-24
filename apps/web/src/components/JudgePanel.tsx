import { useState } from "react";
import type { JudgeResult } from "@codequest/judge";

interface Props {
  result: JudgeResult | null;
  lastRun: { stdout: string; stderr: string; exitCode: number } | null;
}

export function JudgePanel({ result, lastRun }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!result && !lastRun) return <div className="judge-panel muted">点击「运行」查看输出，或「提交」进行判题。</div>;
  const failure = result?.firstFailure;
  return (
    <div className="judge-panel">
      {lastRun && (
        <section>
          <h4>最近一次运行 <span className={lastRun.exitCode === 0 ? "tag ok" : "tag bad"}>
            exit {lastRun.exitCode}
          </span></h4>
          <pre className="output">{lastRun.stdout || "（无输出）"}</pre>
          {lastRun.stderr && <pre className="output error">{lastRun.stderr}</pre>}
        </section>
      )}
      {result && (
        <section>
          <h4>判题结果 <span className={result.passed ? "tag ok" : "tag bad"}>
            {result.passed ? "通过" : `未通过 · ${result.score} 分`}
          </span></h4>
          <ul className="cases">
            {result.results.map((test) => (
              <li key={test.id} className={test.passed ? "pass" : "fail"}>
                <span>{test.passed ? "✓" : "✗"}</span> {test.name}
                <small>{test.reason === "ok" ? "" : ` · ${test.reason}`}</small>
              </li>
            ))}
          </ul>
          {failure && (
            <button className="link" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "收起" : "展开首个失败点的 diff"}
            </button>
          )}
          {expanded && failure && (
            <div className="diff">
              <div><strong>期望输出</strong><pre>{failure.expected}</pre></div>
              <div><strong>你的输出</strong><pre>{failure.actual}</pre></div>
              <table>
                <thead><tr><th>行</th><th>期望</th><th>实际</th></tr></thead>
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
