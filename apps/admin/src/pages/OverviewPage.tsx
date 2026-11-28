import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  ExternalLink,
  FileClock,
  KeyRound,
  Layers3,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useI18n, type Locale } from "@codequest/i18n";
import { api, errorMessage, type AdminConfig, type AdminUser } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { auditActionLabel, batchStatusLabel, formatDate, formatNumber, safeExternalUrl } from "../lib/format";
import type { AdminRoute } from "../lib/router";
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";

export function OverviewPage({ role, config, configLoading, configError, onReloadConfig, navigate }: {
  role: AdminUser["role"];
  config: AdminConfig | null;
  configLoading: boolean;
  configError: unknown;
  onReloadConfig: () => void;
  navigate: (route: AdminRoute) => void;
}) {
  const { t, locale } = useI18n();
  const overview = useAsyncData(() => api.overview(), []);
  const editorUrl = safeExternalUrl(config?.editor_url ?? null);
  const learnerUrl = safeExternalUrl(config?.learner_url ?? null);
  const data = overview.data;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("overview.eyebrow")}
        title={t(role === "teacher" ? "overview.title.teacher" : "overview.title.admin")}
        description={t(role === "teacher" ? "overview.description.teacher" : "overview.description.admin")}
        actions={<Button variant="outline" size="small" onClick={overview.reload} disabled={overview.loading}><RefreshCw size={15} />{t("overview.refresh")}</Button>}
      />

      {overview.loading ? <LoadingState label={t("overview.loading")} /> : overview.error ? <ErrorState error={overview.error} onRetry={overview.reload} title={t("overview.errorTitle")} /> : data && (
        <>
          <section className="metric-grid" aria-label={t("overview.statsLabel")}>
            <MetricCard icon={Users} tone="indigo" locale={locale} label={t("overview.students")} value={data.accounts.total} detail={t("overview.activeCount", { count: formatNumber(data.accounts.active, locale) })} onClick={() => navigate("accounts")} />
            <MetricCard icon={Send} tone="amber" locale={locale} label={t("overview.pendingBatches")} value={data.batches.pending} detail={t("overview.downloadedCount", { count: formatNumber(data.batches.downloaded, locale) })} onClick={() => navigate("batches")} />
            <MetricCard icon={BookOpen} tone="emerald" locale={locale} label={t("overview.enabledCourses")} value={data.courses.enabled} detail={t("overview.coursesUnavailable")} onClick={() => navigate("courses")} />
            <MetricCard icon={KeyRound} tone="rose" locale={locale} label={t("overview.awaitingPassword")} value={data.accounts.password_change_required} detail={t("overview.passwordFirstLogin")} onClick={() => navigate("accounts")} />
          </section>

          <div className="overview-columns">
            <section className="panel health-panel" aria-labelledby="account-health-title">
              <div className="panel-heading"><div><p className="eyebrow">{t("overview.accountHealthEyebrow")}</p><h2 id="account-health-title">{t("overview.accountHealthTitle")}</h2></div><UserRoundCheck size={20} /></div>
              <div className="health-row"><span><i className="status-dot success" />{t("overview.activeStudents")}</span><strong>{formatNumber(data.accounts.active, locale)}</strong></div>
              <div className="health-row"><span><i className="status-dot danger" />{t("overview.disabledStudents")}</span><strong>{formatNumber(data.accounts.disabled, locale)}</strong></div>
              <div className="health-row"><span><i className="status-dot warning" />{t("overview.studentsAwaitingPassword")}</span><strong>{formatNumber(data.accounts.password_change_required, locale)}</strong></div>
              <div className="health-bar" aria-label={t("overview.healthLabel", { active: formatNumber(data.accounts.active, locale), total: formatNumber(data.accounts.total, locale) })}>
                <span style={{ width: `${data.accounts.total ? Math.round(data.accounts.active / data.accounts.total * 100) : 0}%` }} />
              </div>
              <div className="health-row"><span><i className="status-dot success" />{t("overview.teacherAccounts")}</span><strong>{formatNumber(data.teachers.total, locale)}</strong></div>
              <p className="field-hint">{t("overview.teacherStats", { active: formatNumber(data.teachers.active, locale), disabled: formatNumber(data.teachers.disabled, locale), pending: formatNumber(data.teachers.password_change_required, locale) })}</p>
              <Button variant="ghost" size="small" onClick={() => navigate("accounts")}>{t(role === "admin" ? "overview.manageAccounts" : "overview.manageStudents")}<ArrowRight size={14} /></Button>
            </section>

            <section className="panel batch-health-panel" aria-labelledby="batch-health-title">
              <div className="panel-heading"><div><p className="eyebrow">{t("overview.issuanceEyebrow")}</p><h2 id="batch-health-title">{t("overview.issuanceTitle")}</h2></div><Layers3 size={20} /></div>
              <div className="batch-status-grid">
                {(["pending", "downloaded", "expired", "revoked"] as const).map((status) => (
                  <div key={status}><span>{batchStatusLabel(status, t)}</span><strong>{formatNumber(data.batches[status], locale)}</strong></div>
                ))}
              </div>
              <Button variant="ghost" size="small" onClick={() => navigate("batches")}>{t("overview.viewHistory")}<ArrowRight size={14} /></Button>
            </section>

            <section className="panel editor-panel" aria-labelledby="editor-config-title">
              <div className="panel-heading"><div><p className="eyebrow">{t("overview.integrationEyebrow")}</p><h2 id="editor-config-title">{t("overview.integrationTitle")}</h2></div><Settings2 size={20} /></div>
              {configLoading ? <p className="muted">{t("overview.loadingEditor")}</p> : configError ? (
                <><div className="inline-error"><CircleAlert size={16} />{errorMessage(configError, t)}</div><Button variant="outline" size="small" onClick={onReloadConfig}>{t("overview.reloadEditor")}</Button></>
              ) : editorUrl ? (
                <><p>{t("overview.editorConfigured")}</p><a className="button button-primary button-small" href={editorUrl} target="_blank" rel="noreferrer">{t("admin.nav.openEditor")}<ExternalLink size={15} /></a></>
              ) : config?.editor_url ? (
                <><div className="inline-error"><CircleAlert size={16} />{t("overview.invalidEditor")}</div><p className="muted">{t("overview.validUrlHint")}</p></>
              ) : (
                <><p>{t("overview.editorNotConfiguredDescription")}</p><Badge tone="neutral">{t("overview.notConfigured")}</Badge></>
              )}
              {learnerUrl && <a className="learner-link" href={learnerUrl} target="_blank" rel="noreferrer">{t("overview.openLearner")}<ArrowUpRight size={14} /></a>}
            </section>
          </div>

          <section className="panel" aria-labelledby="recent-batches-title">
            <div className="panel-heading"><div><p className="eyebrow">{t("overview.recentEyebrow")}</p><h2 id="recent-batches-title">{t("overview.recentTitle")}</h2><p>{t("overview.recentDescription")}</p></div><Button variant="ghost" size="small" onClick={() => navigate("batches")}>{t("overview.allRecords")}<ArrowRight size={14} /></Button></div>
            {data.recent_batches.length > 0 ? (
              <div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>{t("batches.filename")}</th><th>{t("batches.count")}</th><th>{t("accounts.status")}</th><th>{t("batches.createdAt")}</th><th>{t("batches.expiresAt")}</th></tr></thead><tbody>{data.recent_batches.map((batch) => <tr key={batch.id}><td><span className="file-name"><FileClock size={15} />{batch.filename}</span></td><td>{formatNumber(batch.count, locale)}</td><td><Badge tone={batch.status === "pending" ? "warning" : batch.status === "downloaded" ? "success" : batch.status === "revoked" ? "danger" : "neutral"}>{batchStatusLabel(batch.status, t)}</Badge></td><td>{formatDate(batch.created_at, locale)}</td><td>{formatDate(batch.expires_at, locale)}</td></tr>)}</tbody></table></div>
            ) : <EmptyState title={t("overview.recentEmptyTitle")} description={t("overview.recentEmptyDescription")} action={<Button size="small" onClick={() => navigate("batches")}><Send size={15} />{t("overview.startIssuance")}</Button>} />}
          </section>

          {role === "admin" && (
            <section className="panel" aria-labelledby="recent-audit-title">
              <div className="panel-heading"><div><p className="eyebrow">{t("overview.auditEyebrow")}</p><h2 id="recent-audit-title">{t("overview.auditTitle")}</h2></div><Button variant="ghost" size="small" onClick={() => navigate("audit")}>{t("overview.viewAll")}<ArrowRight size={14} /></Button></div>
              {data.recent_audit.length > 0 ? <div className="audit-timeline">{data.recent_audit.map((event) => <div className="audit-timeline-item" key={event.id}><span className="timeline-icon"><ShieldCheck size={16} /></span><div><strong>{auditActionLabel(event.action, t)}</strong><p>{event.actor_username}{event.target_id ? ` · ${event.target_id}` : ""}</p></div><time dateTime={event.created_at}>{formatDate(event.created_at, locale)}</time></div>)}</div> : <EmptyState title={t("overview.auditEmptyTitle")} description={t("overview.auditEmptyDescription")} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, tone, locale, label, value, detail, onClick }: {
  icon: typeof Users;
  tone: "indigo" | "amber" | "emerald" | "rose";
  locale: Locale;
  label: string;
  value: number;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`metric-card metric-${tone}`} onClick={onClick}>
      <span className="metric-card-top"><span className="metric-icon"><Icon size={20} /></span><ArrowUpRight size={17} /></span>
      <span className="metric-label">{label}</span>
      <strong>{formatNumber(value, locale)}</strong>
      <span className="metric-detail">{detail}</span>
    </button>
  );
}
