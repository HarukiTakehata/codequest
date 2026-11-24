import { Check } from "lucide-react";
import type { GoalStatus } from "@codequest/judge";
import { useI18n } from "../i18n/I18nProvider";

interface Props {
  goals: GoalStatus[];
  allDone: boolean;
  required: boolean;
}

export function GoalPanel({ goals, allDone, required }: Props) {
  const { t } = useI18n();
  const visible = goals.filter((g) => !g.hidden);
  return (
    <aside className="goals">
      <div className="panel-heading"><h3>{t("goals.title")}</h3><span>{visible.filter((goal) => goal.done).length}/{visible.length}</span></div>
      {visible.length === 0 && <p className="muted">{t("goals.empty")}</p>}
      <ul>
        {visible.map((goal) => (
          <li key={goal.id} className={goal.done ? "done" : ""} title={goal.hint}>
            <span className="checkbox">{goal.done && <Check size={13} strokeWidth={3} aria-hidden="true" />}</span>
            <span>{goal.text}</span>
          </li>
        ))}
      </ul>
      {required && <p className={allDone ? "ready" : "muted"}>
        {allDone ? <span className="icon-text"><Check size={14} aria-hidden="true" />{t("goals.ready")}</span> : t("goals.required")}
      </p>}
    </aside>
  );
}
