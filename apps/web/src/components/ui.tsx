"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { classNames } from "@/lib/format";

// ── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "live";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 hover:bg-brand-500 text-white",
  secondary: "bg-ink-800 hover:bg-ink-700 text-ink-100",
  ghost: "bg-transparent hover:bg-ink-850 text-ink-300 hover:text-ink-100",
  danger: "bg-live-500/90 hover:bg-live-500 text-white",
  live: "bg-live-500 hover:brightness-110 text-white",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={classNames(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-base",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={classNames(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

// ── Form fields ────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="text-live-500 mt-1 block text-xs">{error}</span>
      ) : hint ? (
        <span className="text-ink-500 mt-1 block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={classNames("input", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={classNames("input", props.className)} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={classNames("input", props.className)} />;
}

export function Checkbox({
  label,
  description,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        {...rest}
        className="accent-brand-500 mt-0.5 size-4 shrink-0"
      />
      <span>
        <span className="text-ink-100 block text-sm">{label}</span>
        {description && (
          <span className="text-ink-500 block text-xs">{description}</span>
        )}
      </span>
    </label>
  );
}

// ── Feedback ───────────────────────────────────────────────────────────────

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "info" | "success";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={classNames(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "error" && "border-live-500/40 bg-live-500/10 text-live-500",
        tone === "info" && "border-brand-500/40 bg-brand-500/10 text-brand-400",
        tone === "success" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <h3 className="text-base font-medium">{title}</h3>
      <p className="text-ink-500 max-w-sm text-sm">{body}</p>
      {action}
    </div>
  );
}

// ── Status chrome ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  LIVE: "bg-live-500 text-white",
  SCHEDULED: "bg-ink-800 text-ink-300",
  PROCESSING: "bg-amber-500/20 text-amber-400",
  ENDED: "bg-ink-800 text-ink-500",
  CANCELLED: "bg-ink-800 text-ink-500 line-through",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        STATUS_STYLES[status] ?? "bg-ink-800 text-ink-300",
      )}
    >
      {status === "LIVE" && (
        <span className="live-dot size-1.5 rounded-full bg-white" />
      )}
      {status.toLowerCase()}
    </span>
  );
}

export function ViewerPill({ count }: { count: number }) {
  return (
    <span className="bg-ink-850 text-ink-300 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs">
      <svg viewBox="0 0 16 16" className="size-3.5 fill-current" aria-hidden>
        <path d="M8 9.5c-2.9 0-5.25 1.6-5.25 3.5v.75h10.5V13c0-1.9-2.35-3.5-5.25-3.5ZM8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Z" />
      </svg>
      {count}
      <span className="sr-only">viewers</span>
    </span>
  );
}

/** Read-only text plus a copy button. Used for stream keys and ingest URLs. */
export function CopyField({
  value,
  label,
  masked = false,
}: {
  value: string;
  label: string;
  masked?: boolean;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          type={masked ? "password" : "text"}
          onFocus={(event) => event.currentTarget.select()}
          className="input font-mono text-xs"
        />
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="shrink-0"
      onClick={(event) => {
        const button = event.currentTarget;
        // `navigator.clipboard` needs a secure context; on plain http://<ip>
        // deployments it is undefined, so fall back to selecting the field.
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            const original = button.textContent;
            button.textContent = "Copied";
            setTimeout(() => {
              button.textContent = original;
            }, 1200);
          })
          .catch(() => {
            button.textContent = "Press ⌘C";
          });
      }}
    >
      Copy
    </Button>
  );
}
