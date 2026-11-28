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
import { useI18n, type MessageKey } from "@codequest/i18n";
import { api, errorMessage, LocalizedError, type AccountRole, type AdminUser, type IssuedBatch } from "../api";
import { copyText, downloadText } from "../lib/browser";
import { batchStatusLabel, formatDate, formatNumber } from "../lib/format";
import { useToast } from "./Toast";
import { Badge, Button, InlineFieldError } from "./ui";

interface BatchWizardProps {
  ttlHours: number;
  role: AdminUser["role"];
  onCreated: () => void;
}

type Step = "input" | "preview" | "success";

const roleMessageKeys: Record<AccountRole, MessageKey> = {
  student: "role.student",
  teacher: "role.teacher",
};

export function BatchWizard({ ttlHours, role, onCreated }: BatchWizardProps) {
  const { t, locale } = useI18n();
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
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const [credential, setCredential] = useState<{ batch: IssuedBatch; downloadUrl: string } | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const batchRoleLabel = t(roleMessageKeys[batchRole]);

  const sameOriginDownloadUrl = (() => {
    if (!credential) return null;
    try {
      const url = new URL(credential.downloadUrl, window.location.origin);
      return url.origin === window.location.origin ? url.toString() : null;
    } catch {
      return null;
    }
  })();

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
      setError(new LocalizedError("batches.wizard.fileTooLarge"));
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
      setError(new LocalizedError("batches.wizard.fileReadError"));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      setError(new LocalizedError("batches.wizard.oneFile"));
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
      setError(reason);
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
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    downloadText("codequest-accounts-template.csv", "username,email,display_name,password\n");
    toast(t("batches.wizard.templateDownloaded"), "info");
  };

  const copyDownloadUrl = async () => {
    if (!credential || downloadStarted) return;
    try {
      await copyText(sameOriginDownloadUrl ?? credential.downloadUrl);
      toast(t("batches.wizard.linkCopied"));
    } catch (reason) {
      toast(errorMessage(reason, t), "error");
    }
  };

  if (step === "success" && credential) {
    return (
      <section className="panel issuance-success" aria-labelledby="issuance-success-title">
        <div className="success-emblem"><CheckCircle2 size={32} /></div>
        <p className="eyebrow">{t("batches.wizard.successEyebrow")}</p>
        <h2 id="issuance-success-title">{t("batches.wizard.successTitle", { count: formatNumber(credential.batch.count, locale), role: batchRoleLabel })}</h2>
        <p className="success-description">{t("batches.wizard.successDescription")}</p>
        <div className="credential-box">
          <div className="credential-heading"><span><Link2 size={18} />{t("batches.wizard.oneTimeLinkTitle")}</span><Badge tone="warning">{t("batches.wizard.validFor", { hours: formatNumber(ttlHours, locale) })}</Badge></div>
          <label htmlFor="download-url">{t("batches.wizard.downloadUrlLabel")}
            <input id="download-url" className="field credential-input" value={sameOriginDownloadUrl ?? credential.downloadUrl} readOnly onFocus={(event) => event.currentTarget.select()} spellCheck={false} />
          </label>
          <div className="credential-meta">
            <span>{t("batches.wizard.batchFile")}: <strong>{credential.batch.filename}</strong></span>
            <span>{t("batches.wizard.accountRole")}: <strong>{batchRoleLabel}</strong></span>
            <span>{t("batches.expiresAt")}: <strong>{formatDate(credential.batch.expires_at, locale)}</strong></span>
            <span>{t("accounts.status")}: <strong>{downloadStarted ? t("batches.wizard.downloadTriggered") : batchStatusLabel(credential.batch.status, t)}</strong></span>
          </div>
          <div className="credential-actions">
            {downloadStarted ? (
              <Button variant="outline" disabled><Download size={17} />{t("batches.wizard.downloadTriggeredButton")}</Button>
            ) : sameOriginDownloadUrl ? (
              <a className="button button-primary" href={sameOriginDownloadUrl} rel="noreferrer" onClick={() => setDownloadStarted(true)}>
                <Download size={17} />{t("batches.wizard.download")}
              </a>
            ) : <Badge tone="danger">{t("batches.wizard.invalidDownloadUrl")}</Badge>}
            <Button variant="outline" onClick={() => void copyDownloadUrl()} disabled={downloadStarted}><Copy size={16} />{t("batches.wizard.copyLink")}</Button>
          </div>
        </div>
        <div className="notice notice-warning"><AlertTriangle size={19} /><span><strong>{t("batches.wizard.oneTimeWarningTitle")}</strong>{t("batches.wizard.oneTimeWarning")}</span></div>
        <div className="success-footer">
          <span><ShieldCheck size={16} />{t("batches.wizard.notStored")}</span>
          <Button variant="ghost" onClick={reset}><RotateCcw size={16} />{t("batches.wizard.nextBatch")}</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel wizard-panel" aria-labelledby="batch-wizard-title">
      <div className="wizard-heading">
        <div><p className="eyebrow">{t("batches.wizard.eyebrow")}</p><h2 id="batch-wizard-title">{t("batches.wizard.title")}</h2><p>{t("batches.wizard.description")}</p></div>
        <Button variant="outline" size="small" onClick={downloadTemplate}><Download size={16} />{t("batches.wizard.downloadTemplate")}</Button>
      </div>
      <ol className="stepper" aria-label={t("batches.wizard.stepsLabel")}>
        {[
          { id: "input", labelKey: "batches.wizard.stepInput" },
          { id: "preview", labelKey: "batches.wizard.stepPreview" },
          { id: "success", labelKey: "batches.wizard.stepSuccess" },
        ].map((item, index) => {
          const currentIndex = step === "input" ? 0 : step === "preview" ? 1 : 2;
          return (
            <li key={item.id} className={index === currentIndex ? "is-current" : index < currentIndex ? "is-done" : ""} aria-current={index === currentIndex ? "step" : undefined}>
              <span>{index < currentIndex ? <Check size={14} /> : index + 1}</span><strong>{t(item.labelKey as MessageKey)}</strong>
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
            <h3>{t("batches.wizard.dropTitle")}</h3>
            <p>{t("batches.wizard.dropDescription")}</p>
            <Button variant="outline" onClick={() => fileInput.current?.click()}><FileUp size={16} />{t("batches.wizard.chooseFile")}</Button>
            <input ref={fileInput} className="sr-only" type="file" accept=".csv,text/csv,text/plain" aria-label={t("batches.wizard.fileInputLabel")} onChange={(event) => void loadFile(event.target.files?.[0])} />
          </div>
          <div className="or-divider"><span>{t("batches.wizard.orPaste")}</span></div>
          <label htmlFor="batch-csv">{t("batches.wizard.csvContent")}
            <textarea
              id="batch-csv"
              className="field csv-textarea"
              value={csv}
              onChange={(event) => { setCsv(event.target.value); setPreview(null); setError(null); }}
              placeholder={t("batches.wizard.csvPlaceholder")}
              rows={8}
              maxLength={200_000}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label htmlFor="batch-filename">{t("batches.wizard.filename")} <span className="optional">{t("accounts.optional")}</span>
            <input id="batch-filename" className="field" value={filename} onChange={(event) => setFilename(event.target.value)} placeholder={t("batches.wizard.filenamePlaceholder")} maxLength={120} />
          </label>
          <label htmlFor="batch-role">{t("accounts.role")}
            <select id="batch-role" className="field" value={batchRole} disabled={!canChooseRole} onChange={(event) => { setAccountRole(event.target.value as AccountRole); setError(null); }}>
              <option value="student">{t("role.student")}</option>
              {canChooseRole && <option value="teacher">{t("role.teacher")}</option>}
            </select>
          </label>
          {!canChooseRole && <p className="field-hint">{t("batches.wizard.roleHint")}</p>}
          <div className="csv-format-note"><FileSpreadsheet size={17} /><span>{t("batches.wizard.formatPrefix")}<code>username,email,display_name[,password]</code>{" "}{t("batches.wizard.formatDetails")}</span></div>
          <InlineFieldError>{error}</InlineFieldError>
          <div className="wizard-actions"><span>{csv.trim() ? t("batches.wizard.rowsImported", { count: formatNumber(csv.split(/\r?\n/).filter((line) => line.trim()).length, locale) }) : t("batches.wizard.notImported")}</span><Button onClick={() => void check()} loading={busy} disabled={!csv.trim()}>{t("batches.wizard.check")}<ArrowRight size={17} /></Button></div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="wizard-content">
          <div className="preview-summary">
            <div><span className="metric-icon"><Users size={20} /></span><p>{t("batches.wizard.previewValid")}<strong>{formatNumber(preview.count, locale)}</strong></p></div>
            <div><span className="metric-icon success"><Check size={20} /></span><p>{t("batches.wizard.previewGenerated")}<strong>{formatNumber(preview.generated_count, locale)}</strong></p></div>
            <div><span className="metric-icon info"><FileSpreadsheet size={20} /></span><p>{t("batches.wizard.previewSpecified")}<strong>{formatNumber(preview.specified_count, locale)}</strong></p></div>
            <div><span className={`metric-icon ${preview.conflicts.length ? "danger" : "success"}`}>{preview.conflicts.length ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}</span><p>{t("batches.wizard.previewConflicts")}<strong>{formatNumber(preview.conflicts.length, locale)}</strong></p></div>
          </div>
          {preview.conflicts.length > 0 ? (
            <div className="notice notice-error" role="alert"><AlertTriangle size={19} /><span>{t("batches.wizard.conflictDescription")}</span></div>
          ) : (
            <div className="notice notice-success"><CheckCircle2 size={19} /><span>{t("batches.wizard.previewSuccess", { count: formatNumber(preview.count, locale), role: batchRoleLabel })}</span></div>
          )}
          {preview.conflicts.length > 0 && (
            <div className="conflict-box"><h3>{t("batches.wizard.conflictTitle")}</h3><ul>{preview.conflicts.slice(0, 12).map((identity) => <li key={identity}>{identity}</li>)}</ul>{preview.conflicts.length > 12 && <p>{t("batches.wizard.moreConflicts", { count: formatNumber(preview.conflicts.length - 12, locale) })}</p>}</div>
          )}
          <div className="table-wrap preview-table-wrap">
            <table className="data-table preview-table">
              <thead><tr><th>#</th><th>{t("accounts.username")}</th><th>{t("accounts.email")}</th><th>{t("accounts.displayName")}</th><th>{t("batches.wizard.initialPassword")}</th></tr></thead>
              <tbody>{preview.rows.map((row, index) => <tr key={`${row.username}-${index}`}><td>{formatNumber(index + 1, locale)}</td><td className="mono">{row.username}</td><td>{row.email || "—"}</td><td>{row.display_name || "—"}</td><td><Badge tone={row.password_mode === "generated" ? "info" : "warning"}>{t(row.password_mode === "generated" ? "batches.wizard.passwordGenerated" : "batches.wizard.passwordSpecified")}</Badge></td></tr>)}</tbody>
            </table>
          </div>
          <label className="confirm-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={preview.conflicts.length > 0 || busy} /><span>{t("batches.wizard.confirm", { count: formatNumber(preview.count, locale), role: batchRoleLabel })}</span></label>
          <InlineFieldError>{error}</InlineFieldError>
          <div className="wizard-actions">
            <Button variant="ghost" onClick={() => { setStep("input"); setError(null); }} disabled={busy}><ArrowLeft size={16} />{t("batches.wizard.back")}</Button>
            <Button onClick={() => void create()} loading={busy} disabled={!confirmed || preview.conflicts.length > 0}>{t("batches.wizard.confirmCreate")}<ArrowRight size={17} /></Button>
          </div>
          {error != null && <p className="field-hint">{t("batches.wizard.networkHint")}</p>}
        </div>
      )}
    </section>
  );
}
