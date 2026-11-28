import { useRef, useState, type DragEvent } from "react";
import { Braces, CheckCircle2, FileJson, FileUp, UploadCloud } from "lucide-react";
import { useI18n } from "@codequest/i18n";
import { api, LocalizedError, type AdminCourse, type CoursePack } from "../api";
import { formatBytes } from "../lib/format";
import { Button, InlineFieldError, Modal } from "./ui";

function parsePack(text: string): { pack: CoursePack; title?: string; slug?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LocalizedError("pack.invalidJson");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalizedError("pack.invalidObject");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new LocalizedError("pack.empty");
  if (entries.some(([, value]) => typeof value !== "string")) {
    throw new LocalizedError("pack.invalidValues");
  }
  const pack = parsed as CoursePack;
  if (new TextEncoder().encode(JSON.stringify(pack)).length > 1_500_000) {
    throw new LocalizedError("pack.tooLarge");
  }
  if (!pack["course.json"]) throw new LocalizedError("pack.missingCourseJson");
  for (const path of Object.keys(pack)) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new LocalizedError("pack.invalidPath", { path });
    }
  }
  let metadata: { title?: unknown; slug?: unknown } = {};
  try {
    const value = JSON.parse(pack["course.json"]) as { title?: unknown; slug?: unknown };
    if (value && typeof value === "object") metadata = value;
  } catch {
    throw new LocalizedError("pack.invalidCourseJson");
  }
  return {
    pack,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    slug: typeof metadata.slug === "string" ? metadata.slug : undefined,
  };
}

export function PackUploadDialog({ open, onClose, onUploaded }: {
  open: boolean;
  onClose: () => void;
  onUploaded: (course: AdminCourse) => void;
}) {
  const { t, locale } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [pack, setPack] = useState<CoursePack | null>(null);
  const [metadata, setMetadata] = useState<{ title?: string; slug?: string }>({});
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode("file");
    setText("");
    setFilename("");
    setPack(null);
    setMetadata({});
    setError(null);
    setDragging(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const validate = (value: string, name: string) => {
    setError(null);
    try {
      const result = parsePack(value);
      setPack(result.pack);
      setMetadata({ title: result.title, slug: result.slug });
      setFilename(name);
    } catch (reason) {
      setPack(null);
      setMetadata({});
      setError(reason);
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const value = await file.text();
      setText(value);
      validate(value, file.name);
    } catch {
      setError(new LocalizedError("pack.readError"));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length !== 1) {
      setError(new LocalizedError("pack.oneFile"));
      return;
    }
    void loadFile(event.dataTransfer.files[0]);
  };

  const upload = async () => {
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.uploadCourse(pack);
      onUploaded(result.course);
      reset();
      onClose();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  const bytes = pack ? new TextEncoder().encode(JSON.stringify(pack)).length : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("pack.title")}
      description={t("pack.description")}
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>{t("common.cancel")}</Button><Button onClick={() => void upload()} loading={busy} disabled={!pack}><UploadCloud size={16} />{t("pack.validateUpload")}</Button></>}
    >
      <div className="segmented-control" aria-label={t("pack.method")}>
        <button type="button" className={mode === "file" ? "is-active" : ""} onClick={() => setMode("file")} aria-pressed={mode === "file"}><FileUp size={16} />{t("pack.file")}</button>
        <button type="button" className={mode === "paste" ? "is-active" : ""} onClick={() => setMode("paste")} aria-pressed={mode === "paste"}><Braces size={16} />{t("pack.paste")}</button>
      </div>
      {mode === "file" ? (
        <div className={`dropzone compact-dropzone ${dragging ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <span className="dropzone-icon"><FileJson size={26} /></span><h3>{filename || t("pack.dropTitle")}</h3><p>{t("pack.dropDescription")}</p>
          <Button variant="outline" size="small" onClick={() => fileInput.current?.click()}>{t("pack.chooseFile")}</Button>
          <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label={t("pack.fileInputLabel")} onChange={(event) => void loadFile(event.target.files?.[0])} />
        </div>
      ) : (
        <label htmlFor="course-pack-json">{t("pack.jsonLabel")}
          <textarea id="course-pack-json" className="field json-textarea" value={text} onChange={(event) => { setText(event.target.value); setPack(null); setMetadata({}); setFilename(""); setError(null); }} onBlur={() => { if (text.trim()) validate(text, t("pack.pastedFilename")); }} placeholder={t("pack.placeholder")} rows={10} spellCheck={false} autoComplete="off" />
        </label>
      )}
      {pack && (
        <div className="pack-summary" role="status">
          <CheckCircle2 size={19} /><div><strong>{metadata.title || filename || t("pack.ready")}</strong><p>{metadata.slug ? `${t("pack.slug", { slug: metadata.slug })} · ` : ""}{t("pack.fileCount", { count: Object.keys(pack).length })} · {formatBytes(bytes, locale)}</p></div>
        </div>
      )}
      <div className="notice notice-info"><FileJson size={17} /><span>{t("pack.clientValidation")}</span></div>
      <InlineFieldError>{error}</InlineFieldError>
    </Modal>
  );
}
