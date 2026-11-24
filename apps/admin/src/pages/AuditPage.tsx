import { useState } from "react";
import { FileClock, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { auditActionLabel, auditTargetLabels, formatDate, initials } from "../lib/format";
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader, Pagination } from "../components/ui";

const limit = 20;

function safeMetadata(metadata: Record<string, unknown>): string {
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
        key,
        /password|secret|token|csv/i.test(key) ? "[已隐藏]" : redact(nested),
      ]));
    }
    return value;
  };
  return Object.keys(metadata).length > 0 ? JSON.stringify(redact(metadata), null, 2) : "无附加信息";
}

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const audit = useAsyncData(() => api.audit(limit, offset), [offset]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AUDIT LOG"
        title="审计记录"
        description="追踪管理员操作。记录按时间倒序展示，元数据中的敏感字段会被额外隐藏。"
        actions={<Button variant="outline" size="small" onClick={audit.reload} disabled={audit.loading}><RefreshCw size={15} />刷新</Button>}
      />
      <section className="panel" aria-labelledby="audit-table-title">
        <div className="panel-heading"><div><p className="eyebrow">TRACEABILITY</p><h2 id="audit-table-title">操作日志</h2><p>审计接口不返回密码、CSV 明文或下载 token。</p></div><Badge tone="info"><ShieldCheck size={13} />只读记录</Badge></div>
        {audit.loading ? <LoadingState label="正在加载审计记录" /> : audit.error ? <ErrorState error={audit.error} onRetry={audit.reload} /> : (
          <>
            {audit.data && audit.data.events.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table audit-table">
                  <caption className="sr-only">管理员审计记录</caption>
                  <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标</th><th>详细信息</th></tr></thead>
                  <tbody>{audit.data.events.map((event) => (
                    <tr key={event.id}>
                      <td data-label="时间"><time className="audit-time" dateTime={event.created_at}>{formatDate(event.created_at)}</time></td>
                      <td data-label="操作者"><div className="account-cell"><span className="avatar small-avatar">{initials(null, event.actor_username, event.actor_email)}</span><span><strong>{event.actor_username}</strong><small className="mono">{event.actor_id}</small></span></div></td>
                      <td data-label="动作"><span className="audit-action"><FileClock size={15} />{auditActionLabel(event.action)}</span><code className="action-code">{event.action}</code></td>
                      <td data-label="目标"><Badge tone="neutral">{auditTargetLabels[event.target_type] ?? event.target_type}</Badge>{event.target_id && <small className="target-id mono">{event.target_id}</small>}</td>
                      <td data-label="详细信息">{Object.keys(event.metadata).length > 0 ? <details className="metadata-details"><summary>查看详情</summary><pre>{safeMetadata(event.metadata)}</pre></details> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <EmptyState title="暂无审计记录" description="管理操作发生后，对应审计事件会显示在这里。" />}
            <Pagination total={audit.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} label="审计记录分页" />
          </>
        )}
      </section>
    </div>
  );
}
