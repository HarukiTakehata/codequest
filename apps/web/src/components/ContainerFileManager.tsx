import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle, ArrowUp, Check, ChevronRight, FilePlus2, FolderPlus, FolderTree,
  Home, LoaderCircle, PanelLeftClose, Pencil, RefreshCw, Save, Trash2, X,
} from "lucide-react";
import type { InteractiveCommandBridge, TerminalCommandResult } from "@codequest/runtime-shell/src/interactive-command-bridge";
import { useI18n } from "../i18n/I18nProvider";
import {
  buildCreateDirectoryCommand, buildDeleteCommand, buildListCommand, buildReadTextCommand,
  buildRenameCommand, buildWorkspaceSnapshotCommand, buildWriteCommand, containerBasename, FILE_MANAGER_ROOT, formatFileSize,
  joinContainerPath, materialIconUrl, MAX_TEXT_FILE_BYTES, normalizeContainerPath,
  parentContainerPath, parseLsListing, parseWorkspaceSnapshot, validateEntryName, type ContainerFileEntry, type ContainerListing,
} from "../file-manager";

interface Props {
  bridge: InteractiveCommandBridge | null;
  ready: boolean;
  idle: boolean;
  activityToken: number;
  resetKey: string;
  onClose: () => void;
}

interface PreviewState {
  entry: ContainerFileEntry;
  loading: boolean;
  content: string;
  original: string;
  editing: boolean;
  tooLarge: boolean;
}

type DialogState =
  | { kind: "new-file" | "new-folder" }
  | { kind: "rename"; entry: ContainerFileEntry }
  | { kind: "delete"; entry: ContainerFileEntry }
  | null;

const encoder = new TextEncoder();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ContainerFileManager({ bridge, ready, idle, activityToken, resetKey, onClose }: Props) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const epoch = useRef(0);
  const busyRef = useRef(false);
  const [root, setRoot] = useState(FILE_MANAGER_ROOT);
  const [shellCwd, setShellCwd] = useState(FILE_MANAGER_ROOT);
  const [directories, setDirectories] = useState<Record<string, ContainerListing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<ContainerFileEntry | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const disabled = !bridge || !ready || !idle || busy || loadingPaths.size > 0;
  busyRef.current = busy;

  useEffect(() => () => { epoch.current++; }, []);

  const runRaw = useCallback(async (script: string, timeoutMs = 15_000): Promise<TerminalCommandResult> => {
    if (!bridge || !ready) throw new Error(tRef.current("files.unavailable"));
    return bridge.run(script, timeoutMs);
  }, [bridge, ready]);

  const requireSuccess = useCallback((result: TerminalCommandResult): TerminalCommandResult => {
    if (result.exitCode !== 0) throw new Error(result.stdout.trim() || `Container command exited with code ${result.exitCode}`);
    return result;
  }, []);

  const loadDirectory = useCallback(async (path: string, operationEpoch = epoch.current) => {
    if (!bridge || !ready) return;
    const normalized = normalizeContainerPath(path);
    setLoadingPaths((current) => new Set(current).add(normalized));
    try {
      const result = requireSuccess(await runRaw(buildListCommand(normalized), 20_000));
      if (epoch.current !== operationEpoch) return;
      const listing = parseLsListing(normalized, result.stdout);
      setDirectories((current) => ({ ...current, [normalized]: listing }));
      setError("");
    } catch (cause) {
      if (epoch.current !== operationEpoch) return;
      const message = messageOf(cause);
      setError(message.includes("shell prompt") ? tRef.current("files.busy") : `${tRef.current("files.error")} ${message}`);
    } finally {
      if (epoch.current === operationEpoch) {
        setLoadingPaths((current) => {
          const next = new Set(current);
          next.delete(normalized);
          return next;
        });
      }
    }
  }, [bridge, ready, requireSuccess, runRaw]);

  const openRoot = useCallback(async (path: string, operationEpoch = epoch.current + 1) => {
    const normalized = normalizeContainerPath(path);
    epoch.current = operationEpoch;
    setRoot(normalized);
    setDirectories({});
    setExpanded(new Set([normalized]));
    setSelected(null);
    setPreview(null);
    setError("");
    await loadDirectory(normalized, operationEpoch);
  }, [loadDirectory]);

  const refresh = useCallback(async () => {
    if (!bridge || !ready || !idle) return;
    const operationEpoch = ++epoch.current;
    setBusy(true);
    busyRef.current = true;
    setError("");
    try {
      const result = requireSuccess(await runRaw(buildWorkspaceSnapshotCommand(), 20_000));
      if (epoch.current !== operationEpoch) return;
      const snapshot = parseWorkspaceSnapshot(result.stdout);
      setShellCwd(snapshot.cwd);
      setRoot(snapshot.cwd);
      setDirectories({ [snapshot.cwd]: snapshot.listing });
      setExpanded(new Set([snapshot.cwd]));
      setSelected(null);
      setPreview(null);
    } catch (cause) {
      if (epoch.current === operationEpoch) {
        const message = messageOf(cause);
        setError(message.includes("shell prompt") ? tRef.current("files.busy") : message);
      }
    } finally {
      if (epoch.current === operationEpoch) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  }, [bridge, ready, idle, requireSuccess, runRaw]);

  useEffect(() => {
    setBusy(false);
    busyRef.current = false;
    setDialog(null);
    setName("");
    if (bridge && ready && idle) void refresh();
    // resetKey identifies a new container even if the bridge object is reused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, ready, resetKey]);

  useEffect(() => {
    if (activityToken > 0 && bridge && ready && idle && !busyRef.current) void refresh();
    // A terminal command completing is the signal to re-read cwd and files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityToken]);

  const toggleDirectory = async (entry: ContainerFileEntry) => {
    setSelected(entry);
    setPreview(null);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!expanded.has(entry.path) && !directories[entry.path]) await loadDirectory(entry.path);
  };

  const openFile = async (entry: ContainerFileEntry) => {
    if (!bridge || !ready || busy) return;
    const operationEpoch = epoch.current;
    setSelected(entry);
    setPreview({ entry, loading: true, content: "", original: "", editing: false, tooLarge: false });
    try {
      const result = await runRaw(buildReadTextCommand(entry.path), 25_000);
      if (epoch.current !== operationEpoch) return;
      if (result.exitCode === 75) {
        setPreview({ entry, loading: false, content: "", original: "", editing: false, tooLarge: true });
        return;
      }
      requireSuccess(result);
      setPreview({ entry, loading: false, content: result.stdout, original: result.stdout, editing: false, tooLarge: false });
    } catch (cause) {
      if (epoch.current !== operationEpoch) return;
      setError(messageOf(cause));
      setPreview(null);
    }
  };

  const performAction = async (action: () => Promise<void>) => {
    if (disabled) return;
    const operationEpoch = epoch.current;
    setBusy(true);
    busyRef.current = true;
    setError("");
    try {
      await action();
    } catch (cause) {
      if (epoch.current === operationEpoch) {
        const message = messageOf(cause);
        setError(message.includes("shell prompt") ? tRef.current("files.busy") : message);
      }
    } finally {
      if (epoch.current === operationEpoch) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  };

  const savePreview = () => {
    if (!preview || preview.tooLarge) return;
    void performAction(async () => {
      const bytes = encoder.encode(preview.content);
      if (bytes.byteLength > MAX_TEXT_FILE_BYTES) throw new Error(tRef.current("files.tooLarge", { name: preview.entry.name, limit: "256 KiB" }));
      if (!bridge) throw new Error(tRef.current("files.unavailable"));
      requireSuccess(await bridge.runInput(buildWriteCommand(preview.entry.path, preview.content), 30_000));
      const updated = { ...preview.entry, size: bytes.byteLength };
      setSelected(updated);
      setPreview({ ...preview, entry: updated, original: preview.content, editing: false });
      setDirectories((current) => {
        const next = { ...current };
        delete next[parentContainerPath(preview.entry.path)];
        return next;
      });
      await loadDirectory(parentContainerPath(preview.entry.path));
      setNotice(tRef.current("files.saved", { name: preview.entry.name }));
    });
  };

  const submitDialog = (event: FormEvent) => {
    event.preventDefault();
    const current = dialog;
    if (!current) return;
    const creationParent = selected?.kind === "directory" ? selected.path : root;
    let targetName: string;
    if (current.kind === "delete") targetName = current.entry.name;
    else {
      try { targetName = validateEntryName(name.trim()); }
      catch (cause) { setError(messageOf(cause)); return; }
    }
    void performAction(async () => {
      if (current.kind === "delete") {
        requireSuccess(await runRaw(buildDeleteCommand(current.entry.path)));
        setSelected(null);
        setPreview(null);
        setNotice(tRef.current("files.deleted", { name: current.entry.name }));
      } else if (current.kind === "rename" && current.entry) {
        const destination = joinContainerPath(parentContainerPath(current.entry.path), targetName);
        requireSuccess(await runRaw(buildRenameCommand(current.entry.path, destination)));
        setSelected(null);
        setPreview(null);
        setNotice(tRef.current("files.renamed", { name: targetName }));
      } else if (current.kind === "new-folder") {
        const destination = joinContainerPath(creationParent, targetName);
        requireSuccess(await runRaw(buildCreateDirectoryCommand(destination)));
        setExpanded((previous) => new Set(previous).add(destination));
        setSelected({ name: targetName, path: destination, kind: "directory", size: 0, modifiedAt: Date.now(), mode: 0o755, executable: true });
        setNotice(tRef.current("files.created", { name: targetName }));
      } else {
        const destination = joinContainerPath(creationParent, targetName);
        requireSuccess(await runRaw(buildWriteCommand(destination, "")));
        setNotice(tRef.current("files.created", { name: targetName }));
      }
      setDialog(null);
      setName("");
      const affectedPath = current.kind === "rename" && current.entry
        ? parentContainerPath(current.entry.path)
        : current.kind === "delete" ? parentContainerPath(current.entry.path) : creationParent;
      setDirectories((previous) => {
        const next = { ...previous };
        delete next[affectedPath];
        if (affectedPath !== root) delete next[root];
        return next;
      });
      await loadDirectory(affectedPath);
      if (affectedPath !== root) await loadDirectory(root);
    });
  };

  const openDialog = (next: DialogState) => {
    setName(next?.kind === "rename" ? next.entry.name : "");
    setError("");
    setDialog(next);
  };

  const renderEntry = (entry: ContainerFileEntry, depth: number): ReactNode => {
    const isDirectory = entry.kind === "directory";
    const isExpanded = expanded.has(entry.path);
    const children = directories[entry.path]?.entries ?? [];
    const isLoading = loadingPaths.has(entry.path);
    return (
      <div key={entry.path} role="none">
        <div
          className={`file-tree-row${selected?.path === entry.path ? " is-selected" : ""}`}
          role="treeitem"
          aria-expanded={isDirectory ? isExpanded : undefined}
          aria-selected={selected?.path === entry.path}
          style={{ paddingInlineStart: `${8 + depth * 14}px` }}
        >
          {isDirectory ? (
            <button className="file-tree-main" disabled={disabled} onClick={() => void toggleDirectory(entry)} title={entry.path}>
              <ChevronRight className={`file-tree-chevron${isExpanded ? " is-expanded" : ""}`} size={14} />
              <img className="material-file-icon" src={materialIconUrl(entry, isExpanded)} alt="" width={18} height={18} draggable={false} />
              <span className="file-tree-name">{entry.name}</span>
            </button>
          ) : (
            <button className="file-tree-main" disabled={disabled} onClick={() => void openFile(entry)} title={entry.path}>
              <span className="file-tree-chevron" />
              <img className="material-file-icon" src={materialIconUrl(entry)} alt="" width={18} height={18} draggable={false} />
              <span className="file-tree-name">{entry.name}</span>
            </button>
          )}
          <div className="file-row-actions">
            <button className="file-icon-button" aria-label={t("files.rename")} title={t("files.rename")} disabled={disabled} onClick={() => openDialog({ kind: "rename", entry })}><Pencil size={13} /></button>
            <button className="file-icon-button is-danger" aria-label={t("files.delete")} title={t("files.delete")} disabled={disabled} onClick={() => openDialog({ kind: "delete", entry })}><Trash2 size={13} /></button>
          </div>
        </div>
        {isDirectory && isExpanded && (
          <div role="group" className="file-tree-group">
            {isLoading && <div className="file-tree-message"><LoaderCircle className="spin" size={14} />{t("files.loading")}</div>}
            {!isLoading && children.length === 0 && <div className="file-tree-message">{t("files.empty")}</div>}
            {children.map((child) => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootEntries = directories[root]?.entries ?? [];
  const rootLoading = loadingPaths.has(root);
  const dialogTitle = dialog?.kind === "delete" ? t("files.deleteTitle", { name: dialog.entry.name })
    : dialog?.kind === "rename" ? t("files.renameTitle", { name: dialog.entry.name })
      : dialog?.kind === "new-folder" ? t("files.newFolder") : t("files.newFile");

  return (
    <aside className="container-file-manager" aria-label={t("files.title")} data-ready={ready} data-idle={idle} data-busy={disabled} data-loaded={Boolean(directories[root])} data-root={root}>
      <div className="file-manager-header">
        <div><FolderTree size={17} /><strong>{t("files.title")}</strong></div>
        <button className="file-icon-button" onClick={onClose} aria-label={t("files.hide")} title={t("files.hide")}><PanelLeftClose size={17} /></button>
      </div>
      <div className="file-manager-toolbar">
        <button disabled={disabled} onClick={() => openDialog({ kind: "new-file" })} aria-label={t("files.newFile")} title={t("files.newFile")}><FilePlus2 size={16} /></button>
        <button disabled={disabled} onClick={() => openDialog({ kind: "new-folder" })} aria-label={t("files.newFolder")} title={t("files.newFolder")}><FolderPlus size={16} /></button>
        <span className="file-toolbar-spacer" />
        <button disabled={disabled} onClick={() => void refresh()} aria-label={t("files.refresh")} title={t("files.refresh")}><RefreshCw size={16} className={busy ? "spin" : ""} /></button>
      </div>
      <div className="file-path-bar">
        <button disabled={disabled || root === "/"} onClick={() => void openRoot(parentContainerPath(root))} aria-label={t("files.parentFolder")} title={containerBasename(parentContainerPath(root))}><ArrowUp size={14} /></button>
        <button disabled={disabled || root === shellCwd} onClick={() => void openRoot(shellCwd)} aria-label={shellCwd} title={shellCwd}><Home size={14} /></button>
        <span title={root}>{root}</span>
      </div>
      {error && <div className="file-manager-alert" role="alert"><AlertCircle size={15} /><span>{error}</span><button onClick={() => setError("")} aria-label={t("common.close")}><X size={13} /></button></div>}
      {notice && <div className="file-manager-notice" role="status"><Check size={14} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label={t("common.close")}><X size={13} /></button></div>}
      <div className="file-tree-scroll">
        {!ready && <div className="file-tree-message">{t("files.waiting")}</div>}
        {ready && rootLoading && <div className="file-tree-message"><LoaderCircle className="spin" size={14} />{t("files.loading")}</div>}
        {ready && !rootLoading && (
          <div role="tree" aria-label={root}>
            <div className="file-tree-root"><img src="/vendor/material-icon-theme/icons/folder-root-open.svg" alt="" width={18} height={18} /><span>{root === "/" ? "/" : containerBasename(root)}</span></div>
            {rootEntries.map((entry) => renderEntry(entry, 1))}
            {rootEntries.length === 0 && <div className="file-tree-message root-empty">{t("files.empty")}</div>}
          </div>
        )}
      </div>
      {preview && (
        <section className="file-preview" aria-label={t("files.preview")}>
          <div className="file-preview-header">
            <img src={materialIconUrl(preview.entry)} alt="" width={17} height={17} />
            <span title={preview.entry.path}>{preview.entry.name}</span>
            <span className="muted">{formatFileSize(preview.entry.size)}</span>
            {!preview.loading && !preview.editing && !preview.tooLarge && <button disabled={disabled} onClick={() => setPreview({ ...preview, editing: true })}><Pencil size={13} />{t("files.edit")}</button>}
            <button onClick={() => { setPreview(null); setSelected(null); }} aria-label={t("files.closePreview")}><X size={14} /></button>
          </div>
          <div className="file-preview-body">
            {preview.loading && <div className="file-tree-message"><LoaderCircle className="spin" size={14} />{t("files.loading")}</div>}
            {preview.tooLarge && <div className="file-tree-message">{t("files.tooLarge", { name: preview.entry.name, limit: "256 KiB" })}</div>}
            {!preview.loading && !preview.tooLarge && (preview.editing
              ? <textarea className="file-editor" value={preview.content} onChange={(event) => setPreview({ ...preview, content: event.target.value })} spellCheck={false} aria-label={preview.entry.path} />
              : <pre className="file-content">{preview.content || t("files.empty")}</pre>)}
          </div>
          {preview.editing && <div className="file-preview-footer"><span>{preview.content === preview.original ? t("files.saved", { name: preview.entry.name }) : ""}</span><button className="button button-ghost" disabled={busy} onClick={() => setPreview({ ...preview, content: preview.original, editing: false })}>{t("common.cancel")}</button><button className="button button-primary" disabled={busy} onClick={savePreview}><Save size={14} />{busy ? t("files.saving") : t("files.save")}</button></div>}
        </section>
      )}
      <div className="file-manager-status"><span>{t("files.path")}</span><code>{root}</code></div>
      {dialog && (
        <div className="file-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form className="file-dialog" role="dialog" aria-modal="true" aria-labelledby="file-dialog-title" onSubmit={submitDialog} onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}>
            <div className="file-dialog-title"><h2 id="file-dialog-title">{dialogTitle}</h2><button type="button" onClick={() => setDialog(null)} aria-label={t("common.close")}><X size={17} /></button></div>
            {dialog.kind === "delete" ? <p>{t("files.deleteConfirm")}</p> : <label>{t(dialog.kind === "new-folder" ? "files.folderName" : dialog.kind === "rename" ? "files.name" : "files.fileName")}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required /></label>}
            {error && <p className="bad" role="alert">{error}</p>}
            <div className="file-dialog-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>{t("common.cancel")}</button><button type="submit" className={`button ${dialog.kind === "delete" ? "button-danger" : "button-primary"}`} disabled={busy}>{dialog.kind === "delete" ? <Trash2 size={14} /> : null}{dialog.kind === "delete" ? t("common.delete") : dialog.kind === "rename" ? t("files.rename") : t("files.create")}</button></div>
          </form>
        </div>
      )}
    </aside>
  );
}
