"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { classNames } from "@/lib/format";

// ── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "live" | "glass";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-beige enabled:hover:bg-brand-500 text-on-brand",
  secondary: "bg-brand-500/15 enabled:hover:bg-brand-500/22 text-brand-400",
  ghost: "bg-transparent enabled:hover:bg-brand-500/10 text-brand-400",
  danger: "bg-live-500/12 enabled:hover:bg-live-500/18 text-live-500",
  live: "bg-live-500 enabled:hover:brightness-110 text-white",
  /** For controls floating over video. */
  glass: "bg-white/15 enabled:hover:bg-white/25 text-white backdrop-blur-xl backdrop-saturate-150",
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
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none",
        "ease-ios transition-[transform,background-color,opacity,filter] duration-300 active:scale-[0.96] active:duration-100",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-11 px-5 text-[15px]",
        size === "lg" && "h-[50px] px-6 text-[17px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** UIActivityIndicatorView: eight fading spokes. Sized and coloured by className. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      className={classNames("activity inline-block size-4 shrink-0", className)}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <rect
          key={index}
          x="11"
          y="2"
          width="2"
          height="6"
          rx="1"
          fill="currentColor"
          opacity={1 - index * 0.11}
          transform={`rotate(${-index * 45} 12 12)`}
        />
      ))}
    </svg>
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
        <span className="text-live-500 mt-1.5 ml-1 block text-[13px]">{error}</span>
      ) : hint ? (
        <span className="text-ink-500 mt-1.5 ml-1 block text-[13px]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={classNames("input", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={classNames("input", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={classNames("input", props.className)} />;
}

/**
 * A settings row with an iOS switch. Still a native checkbox underneath, so
 * forms, `checked` and `onChange` behave exactly as before.
 */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
}) {
  return (
    <label
      className={classNames(
        "flex cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="text-ink-100 block text-[15px]">{label}</span>
        {description && (
          <span className="text-ink-500 block text-[13px]">{description}</span>
        )}
      </span>
      <input type="checkbox" role="switch" {...rest} className="peer sr-only" />
      <span
        aria-hidden
        className={classNames(
          "bg-ink-700 peer-checked:bg-brand-500 relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300",
          "peer-focus-visible:outline-brand-500/70 peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2",
          "peer-checked:[&>span]:translate-x-5",
        )}
      >
        <span className="ease-spring absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-transform duration-300" />
      </span>
    </label>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

/**
 * An inset grouped section, as in Settings: a header above the card, an
 * optional footer note below it.
 */
export function Section({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section>
      {(title || aside) && (
        <header className="mb-2.5 flex min-h-8 items-end gap-3 px-1">
          {title && <h2 className="min-w-0 flex-1 text-xl font-bold">{title}</h2>}
          {aside && <div className="ml-auto shrink-0">{aside}</div>}
        </header>
      )}
      <div className={classNames("card overflow-hidden", className)}>
        <div className={classNames("p-5", bodyClassName)}>{children}</div>
      </div>
      {description && <p className="text-ink-500 mt-2 px-4 text-[13px]">{description}</p>}
    </section>
  );
}

/** A labelled figure. Used for the live health readouts and analytics. */
export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div>
      <p className="text-ink-500 text-[13px] font-medium">{label}</p>
      <p
        className={classNames(
          "font-rounded mt-0.5 text-2xl font-semibold tabular-nums",
          tone === "good" && "text-ok-500",
          tone === "warn" && "text-warn-500",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** UISegmentedControl, with the thumb sliding between segments. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  disabled?: boolean;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      role="tablist"
      className={classNames(
        "bg-ink-850 relative grid rounded-[9px] p-[2px] select-none",
        disabled && "opacity-50",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="bg-thumb ease-ios absolute top-[2px] bottom-[2px] left-[2px] rounded-[7px] shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] transition-transform duration-300"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={classNames(
            "relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] whitespace-nowrap transition-opacity disabled:cursor-not-allowed",
            value === option.value ? "font-semibold" : "font-medium active:opacity-60",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
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
        // Errors can quote a long URL; wrap it rather than blow out the layout.
        "animate-fade-in overflow-hidden rounded-2xl px-4 py-3 text-[15px] break-words",
        tone === "error" && "bg-live-500/10 text-live-500",
        tone === "info" && "bg-brand-500/10 text-brand-400",
        tone === "success" && "bg-ok-500/12 text-ink-100",
      )}
    >
      {children}
    </div>
  );
}

/** ContentUnavailableView: centred, quiet, no chrome. */
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
    <div className="animate-fade-in flex flex-col items-center gap-2 px-6 py-24 text-center">
      <h3 className="text-[22px] font-bold">{title}</h3>
      <p className="text-ink-500 max-w-sm text-[15px]">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Status chrome ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  LIVE: "bg-live-500 text-white",
  SCHEDULED: "bg-ink-850 text-ink-300",
  PROCESSING: "bg-brand-500/15 text-brand-400",
  ENDED: "bg-ink-850 text-ink-500",
  CANCELLED: "bg-ink-850 text-ink-500 line-through",
};

const STATUS_LABELS: Record<string, string> = {
  LIVE: "LIVE",
  SCHEDULED: "Upcoming",
  PROCESSING: "Processing",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={classNames(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        status === "LIVE" && "tracking-wide",
        STATUS_STYLES[status] ?? "bg-ink-850 text-ink-300",
      )}
    >
      {status === "LIVE" && <span className="live-dot size-1.5 rounded-full bg-white" />}
      {STATUS_LABELS[status] ?? status.toLowerCase()}
    </span>
  );
}

export function ViewerPill({ count }: { count: number }) {
  return (
    <span className="bg-ink-850 text-ink-300 inline-flex h-[22px] items-center gap-1 rounded-full px-2.5 text-xs font-semibold tabular-nums">
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
          className="input font-mono text-[13px]"
        />
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      type="button"
      variant="secondary"
      className={classNames("w-[92px] shrink-0 px-0", state === "copied" && "text-ok-500")}
      onClick={() => {
        // `navigator.clipboard` needs a secure context; on plain http://<ip>
        // deployments it is undefined, so fall back to selecting the field.
        if (!navigator.clipboard) {
          setState("manual");
          return;
        }
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setState("copied");
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setState("idle"), 1400);
          })
          .catch(() => setState("manual"));
      }}
    >
      {state === "copied" ? (
        <span className="animate-pop-in inline-flex items-center gap-1">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
            <path
              d="m3.5 8.5 3 3 6-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Copied
        </span>
      ) : state === "manual" ? (
        "⌘C"
      ) : (
        "Copy"
      )}
    </Button>
  );
}

/** The navigation bar's back button: a chevron and the parent screen's title. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-brand-500 -ml-1.5 inline-flex items-center gap-0.5 text-[17px] transition-opacity active:opacity-50"
    >
      <svg viewBox="0 0 12 20" className="h-[18px] w-3" fill="none" aria-hidden>
        <path
          d="M10 2 2 10l8 8"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  );
}
