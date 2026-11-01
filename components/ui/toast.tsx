"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "./cn";

export type ToastTone = "neutral" | "success" | "error";

export type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** Milliseconds before it hides; errors stay until closed when 0. Default 4000. */
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null);

/** Short messages at the bottom of the screen, read out by screen readers. */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { ...toast, id }]);
      const duration = toast.duration ?? 4000;
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-nav)+env(safe-area-inset-bottom)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cn(
              "animate-fade-in shadow-raised pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border px-4 py-3",
              toast.tone === "error"
                ? "bg-danger-soft text-on-danger-soft border-transparent"
                : toast.tone === "success"
                  ? "bg-primary-soft text-on-primary-soft border-transparent"
                  : "border-border bg-surface text-text",
            )}
          >
            <div className="min-w-0 flex-1 py-0.5">
              <p className="text-label">{toast.title}</p>
              {toast.body && <p className="text-caption mt-0.5 opacity-90">{toast.body}</p>}
            </div>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
                className="text-label min-h-11 shrink-0 rounded-lg px-2 underline underline-offset-2"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full opacity-80 hover:opacity-100"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast needs a ToastProvider above it.");
  return context;
};
