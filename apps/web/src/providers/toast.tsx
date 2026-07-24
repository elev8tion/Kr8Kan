import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import clsx from "clsx";

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
}

const ToastContext = createContext<{
  toast: (message: string, tone?: Toast["tone"]) => void;
}>({ toast: () => undefined });

/** Toasts: top-center on mobile, bottom-right on desktop. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const toast = useCallback(
    (message: string, tone: Toast["tone"] = "info") => {
      const id = ++counter.current;
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-4 md:right-4 md:top-auto md:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto animate-kr8-in rounded-kr8-md border px-4 py-2.5 text-sm shadow-kr8-md",
              t.tone === "error"
                ? "border-kr8-danger/40 bg-kr8-bg-elevated text-kr8-danger"
                : t.tone === "success"
                  ? "border-kr8-success/40 bg-kr8-bg-elevated text-kr8-success"
                  : "border-kr8-border bg-kr8-bg-elevated text-kr8-fg",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
