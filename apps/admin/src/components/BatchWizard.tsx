import { useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileUp,
  Link2,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  Users,
} from "lucide-react";
import { api, errorMessage, type AccountRole, type AdminUser, type IssuedBatch } from "../api";
import { copyText, downloadText } from "../lib/browser";
import { batchStatusLabels, formatDate } from "../lib/format";
import { useToast } from "./Toast";
import { Badge, Button, InlineFieldError } from "./ui";

interface BatchWizardProps {
  ttlHours: number;
  role: AdminUser["role"];
  onCreated: () => void;
}

type Step = "input" | "preview" | "success";

export function BatchWizard({ ttlHours, role, onCreated }: BatchWizardProps) {
  const toast = useToast();
  const canChooseRole = role === "admin";
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("input");
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [accountRole, setAccountRole] = useState<AccountRole>("student");
  const batchRole = canChooseRole ? accountRole : "student";
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewBatch>> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [credential, setCredential] = useState<{ batch: IssuedBatch; downloadUrl: string } | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);

  const reset = () => {
    setStep("input");
    setCsv("");
    setFilename("");
    setAccountRole("student");
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setCredential(null);
    setDownloadStarted(false);
    setDragging(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 200_000) {
      setError("CSV 文件不能超过 200 KB，请精简名单后重试。");
      return;
    }
    try {
      const text = await file.text();
      setCsv(text);
      setFilename(file.name);
      setPreview(null);
      setConfirmed(false);
      setStep("input");
    } catch {
      setError("无法读取该文件，请重新选择 CSV 文件。");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      setError("请一次拖入一个 CSV 文件。");
      return;
    }
    void loadFile(files[0]);
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.previewBatch(csv, filename || undefined, batchRole);
      setPreview(result);
      setConfirmed(false);
      setStep("preview");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!preview || !confirmed || preview.conflicts.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createBatch(csv, filename || undefined, batchRole);
      setCredential({ batch: result.batch, downloadUrl: result.download_url });
      setCsv("");
      setFilename("");
      setPreview(null);
      setConfirmed(false);
      setStep("success");
      onCreated();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    downloadText("codequest-accounts-template.csv", "username,email,display_name,password\n");
    toast("CSV 模板已下载", "info");
  };

  const copyDownloadUrl = async () => {
    if (!credential || downloadStarted) return;
    try {
      await copyText(sameOriginDownloadUrl ?? credential.downloadUrl);
      toast("发放链接已复制，请通过可信渠道分发");
    } catch (reason) {
      toast(errorMessage(reason), "error");
    }
  };

  const sameOriginDownloadUrl = (() => {
    if (!credential) return null;
    try {
      const url = new URL(credential.downloadUrl, window.location.origin);
      return url.origin === window.location.origin ? url.toString() : null;
    } catch {
      return null;
    }
  })();

  if (step === "success" && credential) {
    return (
      <section className="panel issuance-success" aria-labelledby="issuance-success-title">
        <div className="success-emblem"><CheckCircle2 size={32} /></div>
        <p className="eyebrow">账号已创建</p>
        <h2 id="issuance-success-title">已创建 {credential.batch.count} 个{credential.batch.role === "teacher" ? "教师" : "学生"}账号</h2>
        <p className="success-description">账号已原子写入。请立即下载或复制一次性发放链接，并通过可信渠道发送给对应账号。</p>
        <div className="credential-box">
          <div className="credential-heading"><span><Link2 size={18} />一次性发放链接</span><Badge tone="warning">{ttlHours} 小时内有效</Badge></div>
          <label htmlFor="download-url">发放表下载地址
            <input id="download-url" className="field credential-input" value={sameOriginDownloadUrl ?? credential.downloadUrl} readOnly onFocus={(event) => event.currentTarget.select()} spellCheck={false} />
          </label>
          <div className="credential-meta">
            <span>批次文件：<strong>{credential.batch.filename}</strong></span>
            <span>账号角色：<strong>{credential.batch.role === "teacher" ? "教师" : "学生"}</strong></span>
            <span>过期时间：<strong>{formatDate(credential.batch.expires_at)}</strong></span>
            <span>状态：<strong>{downloadStarted ? "已触发领取（以服务端为准）" : batchStatusLabels[credential.batch.status]}</strong></span>
          </div>
          <div className="credential-actions">
            {downloadStarted ? (
              <Button variant="outline" disabled><Download size={17} />已触发领取，请勿重复</Button>
            ) : sameOriginDownloadUrl ? (
              <a className="button button-primary" href={sameOriginDownloadUrl} rel="noreferrer" onClick={() => setDownloadStarted(true)}>
                <Download size={17} />打开并下载发放表
              </a>
            ) : <Badge tone="danger">下载地址无效</Badge>}
            <Button variant="outline" onClick={() => void copyDownloadUrl()} disabled={downloadStarted}><Copy size={16} />复制链接</Button>
          </div>
        </div>
        <div className="notice notice-warning"><AlertTriangle size={19} /><span><strong>此链接仅可领取一次。</strong>打开下载会原子消费链接；已领取、已撤销或过期后都会失效。历史记录不会再次返回下载地址，关闭此页面后也无法找回。若下载失败，请立即在「成员账号」中重置临时密码。</span></div>
        <div className="success-footer">
          <span><ShieldCheck size={16} />未写入 localStorage、会话存储或分析日志</span>
          <Button variant="ghost" onClick={reset}><RotateCcw size={16} />继续创建下一批</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel wizard-panel" aria-labelledby="batch-wizard-title">
      <div className="wizard-heading">
        <div><p className="eyebrow">CSV · 预览 · 创建</p><h2 id="batch-wizard-title">批量发放账号</h2><p>单次 1–500 个账号，用户名必填，邮箱可空。</p></div>
        <Button variant="outline" size="small" onClick={downloadTemplate}><Download size={16} />下载模板</Button>
      </div>
      <ol className="stepper" aria-label="发号步骤">
        {[
          { id: "input", label: "导入名单" },
          { id: "preview", label: "检查预览" },
          { id: "success", label: "安全发放" },
        ].map((item, index) => {
          const currentIndex = step === "input" ? 0 : step === "preview" ? 1 : 2;
          return (
            <li key={item.id} className={index === currentIndex ? "is-current" : index < currentIndex ? "is-done" : ""} aria-current={index === currentIndex ? "step" : undefined}>
              <span>{index < currentIndex ? <Check size={14} /> : index + 1}</span><strong>{item.label}</strong>
            </li>
          );
        })}
      </ol>

      {step === "input" && (
        <div className="wizard-content">
          <div
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={onDrop}
          >
            <span className="dropzone-icon"><UploadCloud size={27} /></span>
            <h3>拖入 CSV 名单文件</h3>
            <p>支持首行表头；第四列为可选初始密码，留空则自动生成。</p>
            <Button variant="outline" onClick={() => fileInput.current?.click()}><FileUp size={16} />选择 CSV 文件</Button>
            <input ref={fileInput} className="sr-only" type="file" accept=".csv,text/csv,text/plain" aria-label="选择 CSV 名单文件" onChange={(event) => void loadFile(event.target.files?.[0])} />
          </div>
          <div className="or-divider"><span>或直接粘贴</span></div>
          <label htmlFor="batch-csv">CSV 内容
            <textarea
              id="batch-csv"
              className="field csv-textarea"
              value={csv}
              onChange={(event) => { setCsv(event.target.value); setPreview(null); setError(null); }}
              placeholder={"username,email,display_name,password\nalice,alice@example.test,示例学员,\nbob,,第二位学员,"}
              rows={8}
              maxLength={200_000}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label htmlFor="batch-filename">下载文件名 <span className="optional">选填</span>
            <input id="batch-filename" className="field" value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="例如：2026 春季班.csv" maxLength={120} />
          </label>
          <label htmlFor="batch-role">账号角色
            <select id="batch-role" className="field" value={batchRole} disabled={!canChooseRole} onChange={(event) => { setAccountRole(event.target.value as AccountRole); setError(null); }}>
              <option value="student">学生</option>
              {canChooseRole && <option value="teacher">教师</option>}
            </select>
          </label>
          {!canChooseRole && <p className="field-hint">教师只能创建学生账号；教师账号由管理员分配。</p>}
          <div className="csv-format-note"><FileSpreadsheet size={17} /><span>格式：<code>username,email,display_name[,password]</code>。用户名必填，邮箱可空；指定密码至少 10 个字符，且不能以 =、+、-、@ 开头。预览不会创建账号，也不会生成最终随机密码。</span></div>
          <InlineFieldError>{error}</InlineFieldError>
          <div className="wizard-actions"><span>{csv.trim() ? `已输入约 ${csv.split(/\r?\n/).filter((line) => line.trim()).length} 行` : "尚未导入名单"}</span><Button onClick={() => void check()} loading={busy} disabled={!csv.trim()}>检查名单<ArrowRight size={17} /></Button></div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="wizard-content">
          <div className="preview-summary">
            <div><span className="metric-icon"><Users size={20} /></span><p>有效账号<strong>{preview.count}</strong></p></div>
            <div><span className="metric-icon success"><Check size={20} /></span><p>系统生成密码<strong>{preview.generated_count}</strong></p></div>
            <div><span className="metric-icon info"><FileSpreadsheet size={20} /></span><p>指定初始密码<strong>{preview.specified_count}</strong></p></div>
            <div><span className={`metric-icon ${preview.conflicts.length ? "danger" : "success"}`}>{preview.conflicts.length ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}</span><p>账号冲突<strong>{preview.conflicts.length}</strong></p></div>
          </div>
          {preview.conflicts.length > 0 ? (
            <div className="notice notice-error" role="alert"><AlertTriangle size={19} /><span><strong>发现已存在的用户名或邮箱，暂不能创建。</strong>请返回修改名单；正式创建时数据库唯一约束仍会保证整批原子回滚。</span></div>
          ) : (
            <div className="notice notice-success"><CheckCircle2 size={19} /><span>预览检查通过，将创建 <strong>{preview.count}</strong> 个{batchRole === "teacher" ? "教师" : "学生"}账号。正式创建时仍会再次校验，任一用户名或邮箱冲突都会整批回滚。</span></div>
          )}
          {preview.conflicts.length > 0 && (
            <div className="conflict-box"><h3>冲突账号</h3><ul>{preview.conflicts.slice(0, 12).map((identity) => <li key={identity}>{identity}</li>)}</ul>{preview.conflicts.length > 12 && <p>另有 {preview.conflicts.length - 12} 个冲突账号。</p>}</div>
          )}
          <div className="table-wrap preview-table-wrap">
            <table className="data-table preview-table">
              <thead><tr><th>#</th><th>用户名</th><th>邮箱</th><th>显示名称</th><th>初始密码</th></tr></thead>
              <tbody>{preview.rows.map((row, index) => <tr key={`${row.username}-${index}`}><td>{index + 1}</td><td className="mono">{row.username}</td><td>{row.email || "—"}</td><td>{row.display_name || "—"}</td><td><Badge tone={row.password_mode === "generated" ? "info" : "warning"}>{row.password_mode === "generated" ? "系统生成" : "已指定"}</Badge></td></tr>)}</tbody>
            </table>
          </div>
          <label className="confirm-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={preview.conflicts.length > 0 || busy} /><span>我已确认名单无误，创建 <strong>{preview.count}</strong> 个{batchRole === "teacher" ? "教师" : "学生"}账号。</span></label>
          <InlineFieldError>{error}</InlineFieldError>
          <div className="wizard-actions">
            <Button variant="ghost" onClick={() => { setStep("input"); setError(null); }} disabled={busy}><ArrowLeft size={16} />返回修改</Button>
            <Button onClick={() => void create()} loading={busy} disabled={!confirmed || preview.conflicts.length > 0}>确认并创建账号<ArrowRight size={17} /></Button>
          </div>
          {error && <p className="field-hint">如果创建请求因网络中断失败，请先刷新下方批次历史，确认是否已创建成功，再决定是否重试。</p>}
        </div>
      )}
    </section>
  );
}
