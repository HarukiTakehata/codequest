import { useRef, useState, type DragEvent } from "react";
import { Braces, CheckCircle2, FileJson, FileUp, UploadCloud } from "lucide-react";
import { api, errorMessage, type AdminCourse, type CoursePack } from "../api";
import { formatBytes } from "../lib/format";
import { Button, InlineFieldError, Modal } from "./ui";

function parsePack(text: string): { pack: CoursePack; title?: string; slug?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 格式无效，请检查逗号、引号和括号。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("课程包必须是一个 JSON 对象，键为文件路径、值为文件文本。");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new Error("课程包为空。");
  if (entries.some(([, value]) => typeof value !== "string")) {
    throw new Error("课程包中的每个文件内容都必须是字符串。");
  }
  const pack = parsed as CoursePack;
  if (new TextEncoder().encode(JSON.stringify(pack)).length > 1_500_000) {
    throw new Error("课程包编码后不能超过 1.5 MB。");
  }
  if (!pack["course.json"]) throw new Error("课程包缺少 course.json。");
  for (const path of Object.keys(pack)) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new Error(`课程包包含非法路径：${path}`);
    }
  }
  let metadata: { title?: unknown; slug?: unknown } = {};
  try {
    const value = JSON.parse(pack["course.json"]) as { title?: unknown; slug?: unknown };
    if (value && typeof value === "object") metadata = value;
  } catch {
    throw new Error("course.json 不是有效的 JSON。");
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [pack, setPack] = useState<CoursePack | null>(null);
  const [metadata, setMetadata] = useState<{ title?: string; slug?: string }>({});
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError(errorMessage(reason));
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
      setError("无法读取文件，请重新选择。");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length !== 1) {
      setError("请一次拖入一个课程包 JSON 文件。");
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
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const bytes = pack ? new TextEncoder().encode(JSON.stringify(pack)).length : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="上传课程包"
      description="服务端将校验 course.json、challenges 与 judges；同 slug 会创建新版本并自动上架。"
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>取消</Button><Button onClick={() => void upload()} loading={busy} disabled={!pack}><UploadCloud size={16} />校验并上传</Button></>}
    >
      <div className="segmented-control" aria-label="上传方式">
        <button type="button" className={mode === "file" ? "is-active" : ""} onClick={() => setMode("file")} aria-pressed={mode === "file"}><FileUp size={16} />JSON 文件</button>
        <button type="button" className={mode === "paste" ? "is-active" : ""} onClick={() => setMode("paste")} aria-pressed={mode === "paste"}><Braces size={16} />粘贴 JSON</button>
      </div>
      {mode === "file" ? (
        <div className={`dropzone compact-dropzone ${dragging ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <span className="dropzone-icon"><FileJson size={26} /></span><h3>{filename || "拖入课程包 JSON"}</h3><p>文件内容应为文件路径到文本内容的映射。</p>
          <Button variant="outline" size="small" onClick={() => fileInput.current?.click()}>选择 JSON 文件</Button>
          <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label="选择课程包 JSON 文件" onChange={(event) => void loadFile(event.target.files?.[0])} />
        </div>
      ) : (
        <label htmlFor="course-pack-json">课程包 JSON
          <textarea id="course-pack-json" className="field json-textarea" value={text} onChange={(event) => { setText(event.target.value); setPack(null); setMetadata({}); setFilename(""); setError(null); }} onBlur={() => { if (text.trim()) validate(text, "粘贴的课程包.json"); }} placeholder={'{\n  "course.json": "{\\"id\\":\\"demo\\",\\"slug\\":\\"demo\\",\\"title\\":\\"示例课程\\"}",\n  "start.txt": "..."\n}'} rows={10} spellCheck={false} autoComplete="off" />
        </label>
      )}
      {pack && (
        <div className="pack-summary" role="status">
          <CheckCircle2 size={19} /><div><strong>{metadata.title || filename || "课程包已就绪"}</strong><p>{metadata.slug ? `slug：${metadata.slug} · ` : ""}{Object.keys(pack).length} 个文件 · {formatBytes(bytes)}</p></div>
        </div>
      )}
      <div className="notice notice-info"><FileJson size={17} /><span>客户端仅检查 JSON 外层结构，完整 schema 与内容校验以服务端结果为准。非法课程包不会入库。</span></div>
      <InlineFieldError>{error}</InlineFieldError>
    </Modal>
  );
}
