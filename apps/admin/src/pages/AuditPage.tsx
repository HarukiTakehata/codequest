import { useState } from "react";
import { FileClock, RefreshCw, ShieldCheck } from "lucide-react";
import { useI18n, type TranslateFn } from "@codequest/i18n";
import { api } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { auditActionLabel, auditTargetLabel, formatDate, initials } from "../lib/format";
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader, Pagination } from "../components/ui";

const limit = 20;

function safeMetadata(metadata: Record<string, unknown>, t: TranslateFn): string {
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
        key,
        /password|secret|token|csv/i.test(key) ? t("audit.redacted") : redact(nested),
      ]));
    }
    return value;
  };
  return Object.keys(metadata).length > 0 ? JSON.stringify(redact(metadata), null, 2) : t("audit.noMetadata");
}

export function AuditPage() {
  const { t, locale } = useI18n();
  const [offset, setOffset] = useState(0);
  const audit = useAsyncData(() => api.audit(limit, offset), [offset]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("audit.eyebrow")}
        title={t("admin.nav.audit")}
        description={t("audit.description")}
        actions={<Button variant="outline" size="small" onClick={audit.reload} disabled={audit.loading}><RefreshCw size={15} />{t("audit.refresh")}</Button>}
      />
      <section className="panel" aria-labelledby="audit-table-title">
        <div className="panel-heading"><div><p className="eyebrow">{t("audit.traceability")}</p><h2 id="audit-table-title">{t("audit.logTitle")}</h2><p>{t("audit.logDescription")}</p></div><Badge tone="info"><ShieldCheck size={13} />{t("audit.readOnly")}</Badge></div>
        {audit.loading ? <LoadingState label={t("audit.loading")} /> : audit.error ? <ErrorState error={audit.error} onRetry={audit.reload} /> : (
          <>
            {audit.data && audit.data.events.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table audit-table">
                  <caption className="sr-only">{t("audit.caption")}</caption>
                  <thead><tr><th>{t("audit.time")}</th><th>{t("audit.actor")}</th><th>{t("audit.action")}</th><th>{t("audit.target")}</th><th>{t("audit.details")}</th></tr></thead>
                  <tbody>{audit.data.events.map((event) => (
                    <tr key={event.id}>
                      <td data-label={t("audit.time")}><time className="audit-time" dateTime={event.created_at}>{formatDate(event.created_at, locale)}</time></td>
                      <td data-label={t("audit.actor")}><div className="account-cell"><span className="avatar small-avatar">{initials(null, event.actor_username, event.actor_email)}</span><span><strong>{event.actor_username}</strong><small className="mono">{event.actor_id}</small></span></div></td>
                      <td data-label={t("audit.action")}><span className="audit-action"><FileClock size={15} />{auditActionLabel(event.action, t)}</span><code className="action-code">{event.action}</code></td>
                      <td data-label={t("audit.target")}><Badge tone="neutral">{auditTargetLabel(event.target_type, t)}</Badge>{event.target_id && <small className="target-id mono">{event.target_id}</small>}</td>
                      <td data-label={t("audit.details")}>{Object.keys(event.metadata).length > 0 ? <details className="metadata-details"><summary>{t("audit.viewDetails")}</summary><pre>{safeMetadata(event.metadata, t)}</pre></details> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <EmptyState title={t("audit.emptyTitle")} description={t("audit.emptyDescription")} />}
            <Pagination total={audit.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} label={t("audit.pagination")} />
          </>
        )}
      </section>
    </div>
  );
}
