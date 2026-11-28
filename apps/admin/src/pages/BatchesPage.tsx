import { useState } from "react";
import { Ban, Clock3, FileClock, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { useI18n } from "@codequest/i18n";
import { api, errorMessage, type AdminUser, type IssuedBatch } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { batchStatusLabel, formatDate, formatNumber } from "../lib/format";
import { BatchWizard } from "../components/BatchWizard";
import { useToast } from "../components/Toast";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination } from "../components/ui";

const limit = 20;

function statusTone(status: IssuedBatch["status"]) {
  if (status === "pending") return "warning" as const;
  if (status === "downloaded") return "success" as const;
  if (status === "revoked") return "danger" as const;
  return "neutral" as const;
}

export function BatchesPage({ ttlHours, role }: { ttlHours: number; role: AdminUser["role"] }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<IssuedBatch | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<unknown>(null);
  const history = useAsyncData(() => api.batches(limit, offset), [offset]);

  const revoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await api.revokeBatch(revokeTarget.id);
      toast(t("batches.revoked"));
      setRevokeTarget(null);
      history.reload();
    } catch (reason) {
      setRevokeError(reason);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t("batches.eyebrow")}
        title={t("admin.nav.batches")}
        description={t(role === "admin" ? "batches.description.admin" : "batches.description.teacher")}
        actions={<Button variant="outline" size="small" onClick={history.reload} disabled={history.loading}><RefreshCw size={15} />{t("batches.refresh")}</Button>}
      />
      <BatchWizard ttlHours={ttlHours} role={role} onCreated={history.reload} />

      <section className="panel" aria-labelledby="batch-history-title">
        <div className="panel-heading">
          <div><p className="eyebrow">{t("batches.historyEyebrow")}</p><h2 id="batch-history-title">{t("batches.historyTitle")}</h2><p>{t("batches.historyDescription")}</p></div>
          <Badge tone="info"><Link2 size={13} />{t("batches.oneTimeLink")}</Badge>
        </div>
        {history.loading ? <LoadingState label={t("batches.loading")} /> : history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : (
          <>
            {history.data && history.data.batches.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>{t("batches.filename")}</th><th>{t("batches.count")}</th><th>{t("accounts.status")}</th><th>{t("batches.createdAt")}</th><th>{t("batches.expiresAt")}</th><th>{t("accounts.actions")}</th></tr></thead>
                  <tbody>{history.data.batches.map((batch) => (
                    <tr key={batch.id}>
                      <td><div className="primary-cell"><span className="row-icon"><FileClock size={17} /></span><span><strong>{batch.filename}</strong><small className="mono">{batch.id}</small></span></div></td>
                      <td>{formatNumber(batch.count, locale)}</td>
                      <td><Badge tone={statusTone(batch.status)}>{batchStatusLabel(batch.status, t)}</Badge></td>
                      <td>{formatDate(batch.created_at, locale)}</td>
                      <td>{batch.status === "downloaded" && batch.downloaded_at ? <span title={formatDate(batch.downloaded_at, locale)}>{t("batches.downloadedAt", { date: formatDate(batch.downloaded_at, locale) })}</span> : formatDate(batch.expires_at, locale)}</td>
                      <td>{batch.status === "pending" ? <Button variant="ghost" size="small" className="danger-text" onClick={() => { setRevokeTarget(batch); setRevokeError(null); }}><Ban size={15} />{t("batches.revoke")}</Button> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={t("batches.emptyTitle")} description={t("batches.emptyDescription")} />
            )}
            <Pagination total={history.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} label={t("batches.pagination")} />
          </>
        )}
      </section>

      <div className="security-footnote"><ShieldCheck size={17} /><p>{t("batches.securityFootnote")}</p></div>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => { if (!revoking) setRevokeTarget(null); }}
        title={t("batches.revokeTitle")}
        description={t("batches.revokeDescription")}
        footer={<><Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>{t("common.cancel")}</Button><Button variant="danger" onClick={() => void revoke()} loading={revoking}><Ban size={16} />{t("batches.confirmRevoke")}</Button></>}
      >
        {revokeTarget && <div className="confirm-summary"><span><Clock3 size={18} />{t("batches.batchLabel")}</span><strong>{revokeTarget.filename}</strong><p>{t("batches.revokeSummary", { count: formatNumber(revokeTarget.count, locale), date: formatDate(revokeTarget.created_at, locale) })}</p></div>}
        <div className="notice notice-warning"><Ban size={18} /><span>{t("batches.revokeNotice")}</span></div>
        {revokeError != null && <p className="form-message error" role="alert">{errorMessage(revokeError, t)}</p>}
      </Modal>
    </div>
  );
}
