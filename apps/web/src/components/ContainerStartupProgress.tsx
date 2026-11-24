import { useI18n } from "../i18n/I18nProvider";

export interface ContainerStartupProgressState {
  phase: "downloading" | "starting" | "error";
  loaded?: number;
  total?: number;
  message?: string;
  environment?: string;
  requestId?: string;
}

export function startupPercent(loaded = 0, total = 0): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

export function formatRuntimeBytes(bytes = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MiB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function ContainerStartupProgress({ progress }: { progress: ContainerStartupProgressState }) {
  const { t } = useI18n();
  const downloading = progress.phase === "downloading";
  const error = progress.phase === "error";
  const percent = startupPercent(progress.loaded, progress.total);
  const title = t(error ? "progress.error" : downloading ? "progress.loading" : "progress.starting");
  const detail = error
    ? progress.message || t("progress.retry")
    : downloading
      ? progress.total
        ? `${formatRuntimeBytes(progress.loaded)} / ${formatRuntimeBytes(progress.total)}`
        : t("progress.transferred", { loaded: formatRuntimeBytes(progress.loaded) })
      : t("progress.initializing");

  return (
    <div className={`container-startup-progress is-${progress.phase}`} role="status" aria-live="polite">
      <div className="container-startup-heading">
        <span>{title}</span>
        {downloading && <strong>{percent}%</strong>}
      </div>
      <div
        className="container-startup-track"
        role="progressbar"
        aria-label={title}
        {...(downloading
          ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }
          : { "aria-valuetext": error ? t("progress.failed") : t("progress.startingShort") })}
      >
        <div
          className={`container-startup-bar ${downloading ? "is-determinate" : "is-indeterminate"}`}
          style={downloading ? { width: `${percent}%` } : undefined}
        />
      </div>
      <p>{detail}</p>
    </div>
  );
}
