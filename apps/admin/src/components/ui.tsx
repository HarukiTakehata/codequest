import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CircleAlert, Inbox, LoaderCircle, RefreshCw, SearchX, X } from "lucide-react";
import { errorMessage, requestIdOf } from "../api";

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

export function LoadingState({ label = "正在加载数据…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-label={label}>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-block" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "暂时无法加载" }: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const requestId = requestIdOf(error);
  return (
    <div className="state-panel state-error" role="alert">
      <span className="state-icon"><CircleAlert size={24} aria-hidden="true" /></span>
      <h2>{title}</h2>
      <p>{errorMessage(error)}</p>
      {requestId && <p className="request-id">请求编号：{requestId}</p>}
      {onRetry && <Button variant="outline" onClick={onRetry}><RefreshCw size={16} />重试</Button>}
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
  return (
    <div className="state-panel compact-state">
      <span className="state-icon"><SearchX size={22} aria-hidden="true" /></span>
      <h2>没有找到匹配的成员</h2>
      <p>试试其他关键词，或清除搜索与筛选条件。</p>
      <Button variant="outline" size="small" onClick={onReset}>清除条件</Button>
    </div>
  );
}

export function Pagination({ total, limit, offset, onChange, label = "列表分页" }: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  label?: string;
}) {
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
    <nav className="pagination" aria-label={label}>
      <p>共 <strong>{total}</strong> 条{total > 0 && <span> · {start}–{end}</span>}</p>
      <div className="pagination-controls">
        <Button variant="outline" size="small" disabled={current <= 1} onClick={() => onChange((current - 2) * limit)} aria-label="上一页">
          <ArrowLeft size={15} />上一页
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
              aria-label={`第 ${entry} 页`}
              onClick={() => onChange((entry - 1) * limit)}
            >{entry}</button>
          ))}
        </div>
        <Button variant="outline" size="small" disabled={current >= pages || total === 0} onClick={() => onChange(current * limit)} aria-label="下一页">
          下一页<ArrowRight size={15} />
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
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭对话框"><X size={20} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function InlineFieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return <p className="field-error" role="alert">{children}</p>;
}
