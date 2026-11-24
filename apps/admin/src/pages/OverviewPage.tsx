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
import { api, errorMessage, type AdminConfig, type AdminUser } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { auditActionLabel, batchStatusLabels, formatDate, safeExternalUrl } from "../lib/format";
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
  const overview = useAsyncData(() => api.overview(), []);
  const editorUrl = safeExternalUrl(config?.editor_url ?? null);
  const learnerUrl = safeExternalUrl(config?.learner_url ?? null);
  const data = overview.data;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="WORKSPACE OVERVIEW"
        title={role === "teacher" ? "欢迎回来，教师" : "欢迎回来，管理员"}
        description={role === "teacher" ? "掌握学生账号、课程与发放状态；教师账号管理与审计仅限管理员。" : "掌握学生与教师账号、课程与发放状态，所有关键操作都有审计记录。"}
        actions={<Button variant="outline" size="small" onClick={overview.reload} disabled={overview.loading}><RefreshCw size={15} />刷新概览</Button>}
      />

      {overview.loading ? <LoadingState label="正在加载概览统计" /> : overview.error ? <ErrorState error={overview.error} onRetry={overview.reload} title="概览加载失败" /> : data && (
        <>
          <section className="metric-grid" aria-label="核心统计">
            <MetricCard icon={Users} tone="indigo" label="学生账号" value={data.accounts.total} detail={`${data.accounts.active} 位活跃`} onClick={() => navigate("accounts")} />
            <MetricCard icon={Send} tone="amber" label="待领取批次" value={data.batches.pending} detail={`${data.batches.downloaded} 批已领取`} onClick={() => navigate("batches")} />
            <MetricCard icon={BookOpen} tone="emerald" label="已上架课程" value={data.courses.enabled} detail="当前版本不提供课程" onClick={() => navigate("courses")} />
            <MetricCard icon={KeyRound} tone="rose" label="等待改密" value={data.accounts.password_change_required} detail="首次登录前需更新" onClick={() => navigate("accounts")} />
          </section>

          <div className="overview-columns">
            <section className="panel health-panel" aria-labelledby="account-health-title">
              <div className="panel-heading"><div><p className="eyebrow">ACCOUNT HEALTH</p><h2 id="account-health-title">学生账号状态</h2></div><UserRoundCheck size={20} /></div>
              <div className="health-row"><span><i className="status-dot success" />活跃学生</span><strong>{data.accounts.active}</strong></div>
              <div className="health-row"><span><i className="status-dot danger" />已停用学生</span><strong>{data.accounts.disabled}</strong></div>
              <div className="health-row"><span><i className="status-dot warning" />学生等待改密</span><strong>{data.accounts.password_change_required}</strong></div>
              <div className="health-bar" aria-label={`活跃学生 ${data.accounts.active}，共 ${data.accounts.total}`}>
                <span style={{ width: `${data.accounts.total ? Math.round(data.accounts.active / data.accounts.total * 100) : 0}%` }} />
              </div>
              <div className="health-row"><span><i className="status-dot success" />教师账号</span><strong>{data.teachers.total}</strong></div>
              <p className="field-hint">{data.teachers.active} 位活跃 · {data.teachers.disabled} 位停用 · {data.teachers.password_change_required} 位待改密</p>
              <Button variant="ghost" size="small" onClick={() => navigate("accounts")}>{role === "admin" ? "管理账号" : "管理学生"}<ArrowRight size={14} /></Button>
            </section>

            <section className="panel batch-health-panel" aria-labelledby="batch-health-title">
              <div className="panel-heading"><div><p className="eyebrow">ISSUANCE STATUS</p><h2 id="batch-health-title">发放批次</h2></div><Layers3 size={20} /></div>
              <div className="batch-status-grid">
                {(["pending", "downloaded", "expired", "revoked"] as const).map((status) => (
                  <div key={status}><span>{batchStatusLabels[status]}</span><strong>{data.batches[status]}</strong></div>
                ))}
              </div>
              <Button variant="ghost" size="small" onClick={() => navigate("batches")}>查看批次历史<ArrowRight size={14} /></Button>
            </section>

            <section className="panel editor-panel" aria-labelledby="editor-config-title">
              <div className="panel-heading"><div><p className="eyebrow">INTEGRATION</p><h2 id="editor-config-title">课程编辑器</h2></div><Settings2 size={20} /></div>
              {configLoading ? <p className="muted">正在读取 editor_url…</p> : configError ? (
                <><div className="inline-error"><CircleAlert size={16} />{errorMessage(configError)}</div><Button variant="outline" size="small" onClick={onReloadConfig}>重新读取</Button></>
              ) : editorUrl ? (
                <><p>独立编辑器已配置，可复用当前登录会话。</p><a className="button button-primary button-small" href={editorUrl} target="_blank" rel="noreferrer">打开编辑器<ExternalLink size={15} /></a></>
              ) : config?.editor_url ? (
                <><div className="inline-error"><CircleAlert size={16} />editor_url 格式无效</div><p className="muted">请配置有效的 HTTP(S) 地址。</p></>
              ) : (
                <><p>尚未配置 <code>EDITOR_URL</code>。完成后可在这里快速打开独立编辑器。</p><Badge tone="neutral">未配置</Badge></>
              )}
              {learnerUrl && <a className="learner-link" href={learnerUrl} target="_blank" rel="noreferrer">打开学员端<ArrowUpRight size={14} /></a>}
            </section>
          </div>

          <section className="panel" aria-labelledby="recent-batches-title">
            <div className="panel-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2 id="recent-batches-title">最近发号批次</h2><p>仅展示批次元数据，不包含 CSV 或下载凭据。</p></div><Button variant="ghost" size="small" onClick={() => navigate("batches")}>全部记录<ArrowRight size={14} /></Button></div>
            {data.recent_batches.length > 0 ? (
              <div className="table-wrap"><table className="data-table compact-table"><thead><tr><th>文件</th><th>账号数</th><th>状态</th><th>创建时间</th><th>过期时间</th></tr></thead><tbody>{data.recent_batches.map((batch) => <tr key={batch.id}><td><span className="file-name"><FileClock size={15} />{batch.filename}</span></td><td>{batch.count}</td><td><Badge tone={batch.status === "pending" ? "warning" : batch.status === "downloaded" ? "success" : batch.status === "revoked" ? "danger" : "neutral"}>{batchStatusLabels[batch.status]}</Badge></td><td>{formatDate(batch.created_at)}</td><td>{formatDate(batch.expires_at)}</td></tr>)}</tbody></table></div>
            ) : <EmptyState title="还没有发号记录" description="创建第一批成员账号后，可在这里查看最近状态。" action={<Button size="small" onClick={() => navigate("batches")}><Send size={15} />开始发号</Button>} />}
          </section>

          {role === "admin" && (
            <section className="panel" aria-labelledby="recent-audit-title">
              <div className="panel-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2 id="recent-audit-title">最近审计</h2></div><Button variant="ghost" size="small" onClick={() => navigate("audit")}>查看全部<ArrowRight size={14} /></Button></div>
              {data.recent_audit.length > 0 ? <div className="audit-timeline">{data.recent_audit.map((event) => <div className="audit-timeline-item" key={event.id}><span className="timeline-icon"><ShieldCheck size={16} /></span><div><strong>{auditActionLabel(event.action)}</strong><p>{event.actor_username}{event.target_id ? ` · ${event.target_id}` : ""}</p></div><time dateTime={event.created_at}>{formatDate(event.created_at)}</time></div>)}</div> : <EmptyState title="暂无审计记录" description="发号、账号启停、重置密码与课程变更会记录在这里。" />}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, tone, label, value, detail, onClick }: {
  icon: typeof Users;
  tone: "indigo" | "amber" | "emerald" | "rose";
  label: string;
  value: number;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`metric-card metric-${tone}`} onClick={onClick}>
      <span className="metric-card-top"><span className="metric-icon"><Icon size={20} /></span><ArrowUpRight size={17} /></span>
      <span className="metric-label">{label}</span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
      <span className="metric-detail">{detail}</span>
    </button>
  );
}
