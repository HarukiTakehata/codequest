import { useState } from "react";
import { Ban, Clock3, FileClock, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { api, errorMessage, type AdminUser, type IssuedBatch } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { batchStatusLabels, formatDate } from "../lib/format";
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
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<IssuedBatch | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const history = useAsyncData(() => api.batches(limit, offset), [offset]);

  const revoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await api.revokeBatch(revokeTarget.id);
      toast("批次已撤销，未领取链接现已失效");
      setRevokeTarget(null);
      history.reload();
    } catch (reason) {
      setRevokeError(errorMessage(reason));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ACCOUNT ISSUANCE"
        title="批量发号"
        description={role === "admin" ? "导入学生或教师名单，预览冲突，一次性创建账号并安全分发发放表。" : "导入学生名单，预览冲突，一次性创建账号并安全分发发放表。"}
        actions={<Button variant="outline" size="small" onClick={history.reload} disabled={history.loading}><RefreshCw size={15} />刷新记录</Button>}
      />
      <BatchWizard ttlHours={ttlHours} role={role} onCreated={history.reload} />

      <section className="panel" aria-labelledby="batch-history-title">
        <div className="panel-heading">
          <div><p className="eyebrow">HISTORY</p><h2 id="batch-history-title">批次历史</h2><p>待领取批次可撤销；历史接口不会返回下载链接或明文密码。</p></div>
          <Badge tone="info"><Link2 size={13} />一次性链接</Badge>
        </div>
        {history.loading ? <LoadingState label="正在加载发号批次" /> : history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : (
          <>
            {history.data && history.data.batches.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>批次文件</th><th>账号数</th><th>状态</th><th>创建时间</th><th>过期时间</th><th>操作</th></tr></thead>
                  <tbody>{history.data.batches.map((batch) => (
                    <tr key={batch.id}>
                      <td><div className="primary-cell"><span className="row-icon"><FileClock size={17} /></span><span><strong>{batch.filename}</strong><small className="mono">{batch.id}</small></span></div></td>
                      <td>{batch.count}</td>
                      <td><Badge tone={statusTone(batch.status)}>{batchStatusLabels[batch.status]}</Badge></td>
                      <td>{formatDate(batch.created_at)}</td>
                      <td>{batch.status === "downloaded" && batch.downloaded_at ? <span title={formatDate(batch.downloaded_at)}>领取于 {formatDate(batch.downloaded_at)}</span> : formatDate(batch.expires_at)}</td>
                      <td>{batch.status === "pending" ? <Button variant="ghost" size="small" className="danger-text" onClick={() => { setRevokeTarget(batch); setRevokeError(null); }}><Ban size={15} />撤销</Button> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="还没有发号批次" description="使用上方向导创建第一批成员账号，批次记录会显示在这里。" />
            )}
            <Pagination total={history.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} label="发号批次分页" />
          </>
        )}
      </section>

      <div className="security-footnote"><ShieldCheck size={17} /><p>撤销仅让尚未领取的链接失效，不会停用已经创建的成员账号。如需停用，请前往「成员账号」操作。</p></div>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => { if (!revoking) setRevokeTarget(null); }}
        title="撤销这个发号批次？"
        description="此操作会让尚未领取的下载链接立即失效，且无法恢复。"
        footer={<><Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>取消</Button><Button variant="danger" onClick={() => void revoke()} loading={revoking}><Ban size={16} />确认撤销</Button></>}
      >
        {revokeTarget && <div className="confirm-summary"><span><Clock3 size={18} />批次</span><strong>{revokeTarget.filename}</strong><p>{revokeTarget.count} 个账号 · 创建于 {formatDate(revokeTarget.created_at)}</p></div>}
        <div className="notice notice-warning"><Ban size={18} /><span>已经创建账号仍可登录。如需阻止成员访问，请单独在成员账号中停用。</span></div>
        {revokeError && <p className="form-message error" role="alert">{revokeError}</p>}
      </Modal>
    </div>
  );
}
