import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CircleAlert, Inbox, LoaderCircle, RefreshCw, SearchX, X } from "lucide-react";
import { useI18n } from "@codequest/i18n";
import { errorMessage, requestIdOf } from "../api";
import { formatNumber } from "../lib/format";

export function Button({
  children,
  variant = "primary",
  size = "normal",
  loading = false,
  className = "",
  type = "button",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "normal" | "small";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`button button-${variant} ${size === "small" ? "button-small" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Badge({ children, tone = "neutral" }: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  const loadingLabel = label ?? t("common.loading");
  return (
    <div className="loading-state" role="status" aria-label={loadingLabel}>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-block" />
      <span className="sr-only">{loadingLabel}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry, title }: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const { t } = useI18n();
  const requestId = requestIdOf(error);
  return (
    <div className="state-panel state-error" role="alert">
      <span className="state-icon"><CircleAlert size={24} aria-hidden="true" /></span>
      <h2>{title ?? t("common.loadFailed")}</h2>
      <p>{errorMessage(error, t)}</p>
      {requestId && <p className="request-id">{t("common.requestId", { id: requestId })}</p>}
      {onRetry && <Button variant="outline" onClick={onRetry}><RefreshCw size={16} />{t("common.retry")}</Button>}
    </div>
  );
}

export function EmptyState({ title, description, action }: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel">
      <span className="state-icon"><Inbox size={24} aria-hidden="true" /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SearchEmptyState({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state-panel compact-state">
      <span className="state-icon"><SearchX size={22} aria-hidden="true" /></span>
      <h2>{t("admin.ui.searchEmptyTitle")}</h2>
      <p>{t("admin.ui.searchEmptyDescription")}</p>
      <Button variant="outline" size="small" onClick={onReset}>{t("admin.ui.resetFilters")}</Button>
    </div>
  );
}

export function Pagination({ total, limit, offset, onChange, label }: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  label?: string;
}) {
  const { t, locale } = useI18n();
  const paginationLabel = label ?? t("common.pagination.label");
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(pages, Math.floor(offset / limit) + 1);
  const numbers = new Set<number>([1, pages, current - 1, current, current + 1]);
  const visible = [...numbers].filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
  const entries: Array<number | "ellipsis"> = [];
  visible.forEach((page, index) => {
    if (index > 0 && page - visible[index - 1]! > 1) entries.push("ellipsis");
    entries.push(page);
  });
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <nav className="pagination" aria-label={paginationLabel}>
      <p>{t("common.pagination.totalPrefix")}<strong>{formatNumber(total, locale)}</strong>{t("common.pagination.totalSuffix")}{total > 0 && <span>{t("common.pagination.range", { start: formatNumber(start, locale), end: formatNumber(end, locale) })}</span>}</p>
      <div className="pagination-controls">
        <Button variant="outline" size="small" disabled={current <= 1} onClick={() => onChange((current - 2) * limit)} aria-label={t("common.previousPage")}>
          <ArrowLeft size={15} />{t("common.previousPage")}
        </Button>
        <div className="page-numbers">
          {entries.map((entry, index) => entry === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">…</span>
          ) : (
            <button
              key={entry}
              type="button"
              className={entry === current ? "is-current" : ""}
              aria-current={entry === current ? "page" : undefined}
              aria-label={t("common.page", { page: formatNumber(entry, locale) })}
              onClick={() => onChange((entry - 1) * limit)}
            >{formatNumber(entry, locale)}</button>
          ))}
        </div>
        <Button variant="outline" size="small" disabled={current >= pages || total === 0} onClick={() => onChange(current * limit)} aria-label={t("common.nextPage")}>
          {t("common.nextPage")}<ArrowRight size={15} />
        </Button>
      </div>
    </nav>
  );
}

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, description, children, footer, variant = "default" }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "default" | "drawer";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      target?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className={`modal-backdrop ${variant === "drawer" ? "drawer-backdrop" : ""}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeRef.current();
    }}>
      <div
        ref={dialogRef}
        className={`modal ${variant === "drawer" ? "drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.closeDialog")}><X size={20} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function InlineFieldError({ children }: { children?: unknown }) {
  const { t } = useI18n();
  if (children == null || children === "") return null;
  const message = typeof children === "string" ? children : errorMessage(children, t);
  return <p className="field-error" role="alert">{message}</p>;
}
