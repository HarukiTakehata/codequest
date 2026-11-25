import { Check } from "lucide-react";
import type { GoalStatus } from "@codequest/judge";

interface Props {
  goals: GoalStatus[];
  allDone: boolean;
  required: boolean;
}

export function GoalPanel({ goals, allDone, required }: Props) {
  const visible = goals.filter((g) => !g.hidden);
  return (
    <aside className="goals">
      <h3>目标清单</h3>
      {visible.length === 0 && <p className="muted">本题暂无过程目标</p>}
      <ul>
        {visible.map((goal) => (
          <li key={goal.id} className={goal.done ? "done" : ""} title={goal.hint}>
            <span className="checkbox">{goal.done && <Check size={13} strokeWidth={3} />}</span>
            <span>{goal.text}</span>
          </li>
        ))}
      </ul>
      {required && <p className={allDone ? "ready" : "muted"}>
        {allDone ? <span className="icon-text"><Check size={14} /> 可以提交</span> : "需全部达成后才能提交"}
      </p>}
    </aside>
  );
}
