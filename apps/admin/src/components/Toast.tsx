import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useCallback(() => Date.now() + Math.random(), []);
  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextId();
    setItems((current) => [...current.slice(-2), { id, message, tone }]);
  }, [nextId]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" aria-label="通知" aria-live="polite" aria-atomic="false">
        {items.map((item) => <Toast key={item.id} item={item} onClose={() => setItems((current) => current.filter((toast) => toast.id !== item.id))} />)}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? CircleAlert : Info;
  return (
    <div className={`toast toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
      <Icon size={19} aria-hidden="true" />
      <span>{item.message}</span>
      <button type="button" className="toast-close" onClick={onClose} aria-label="关闭通知"><X size={16} /></button>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastProvider 未挂载");
  return useMemo(() => context, [context]);
}
