import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TOAST_EVENT, type ToastTone } from "../lib/toast";

type Toast = { id: number; message: string; tone: ToastTone };

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; tone?: ToastTone }>).detail;
      if (!detail?.message) return;
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message: detail.message!, tone: detail.tone ?? "error" }].slice(-3));
      window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5200);
    };
    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  if (typeof document === "undefined" || toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[220] flex flex-col items-end gap-2 sm:left-auto sm:right-5 sm:max-w-sm">
      {toasts.map((toast) => {
        const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "info" ? Info : AlertCircle;
        return (
          <div key={toast.id} role="status" className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-white/12 bg-[#12161d]/90 px-3.5 py-3 text-sm text-white shadow-[0_18px_55px_rgba(0,0,0,.5)] backdrop-blur-2xl sm:w-auto sm:min-w-72">
            <Icon className={toast.tone === "error" ? "mt-0.5 h-4 w-4 shrink-0 text-red-300" : toast.tone === "success" ? "mt-0.5 h-4 w-4 shrink-0 text-emerald-300" : "mt-0.5 h-4 w-4 shrink-0 text-sky-300"} />
            <span className="min-w-0 flex-1 leading-5 text-white/82">{toast.message}</span>
            <button type="button" className="shrink-0 text-white/38 transition hover:text-white" onClick={() => setToasts((current) => current.filter((entry) => entry.id !== toast.id))} aria-label="Dismiss notification">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
