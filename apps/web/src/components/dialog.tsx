"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { classNames } from "@/lib/format";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(
  null,
);

/** An iOS-style alert in place of `window.confirm`, awaited the same way. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [closing, setClosing] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setClosing(false);
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      if (!pending || closing) return;
      pending.resolve(ok);
      setClosing(true);
      // Let the fade finish before unmounting.
      setTimeout(() => {
        setPending(null);
        setClosing(false);
      }, 180);
    },
    [pending, closing],
  );

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className={classNames(
            "fixed inset-0 z-50 grid place-items-center bg-black/60 px-6 transition-opacity duration-200",
            closing ? "opacity-0" : "animate-fade-in",
          )}
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(event) => event.stopPropagation()}
            className={classNames(
              "material w-full max-w-[270px] overflow-hidden rounded-[18px] text-center shadow-[0_24px_80px_rgb(0_0_0/0.8)] ring-[0.5px] ring-white/10 transition-[opacity,transform] duration-200",
              closing ? "scale-95 opacity-0" : "animate-pop-in",
            )}
          >
            <div className="px-4 pt-5 pb-4">
              <h2 id="confirm-title" className="text-[17px] leading-snug font-semibold">
                {pending.title}
              </h2>
              {pending.message && (
                <p className="text-ink-300 mt-1 text-[13px] leading-snug">{pending.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 border-t-[0.5px] border-white/10">
              <button
                type="button"
                onClick={() => settle(false)}
                className="text-ink-300 border-r-[0.5px] border-white/10 py-3 text-[17px] transition-colors active:bg-white/10"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => settle(true)}
                className={classNames(
                  "py-3 text-[17px] font-semibold transition-colors active:bg-white/10",
                  pending.destructive ? "text-live-500" : "text-brand-500",
                )}
              >
                {pending.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}
