"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { classNames } from "@/lib/format";

export type ShellNavItem = {
  href: string;
  label: string;
  /** Exact match only (e.g. /admin overview). */
  exact?: boolean;
};

export function ShellFrame({
  brandHref,
  brandBadge,
  mobileTitle,
  nav,
  footer,
  children,
}: {
  brandHref: string;
  brandBadge: string;
  mobileTitle: string;
  nav: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="bg-ink-950 min-h-dvh lg:flex">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={classNames(
          "border-ink-800/80 bg-ink-900 fixed inset-y-0 left-0 z-40 flex w-[15.5rem] flex-col border-r transition-transform duration-200 ease-out lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
      >
        <div className="border-ink-800/80 flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
          <Link
            href={brandHref}
            className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight"
          >
            <span className="bg-brand-600 grid size-7 shrink-0 place-items-center rounded-md text-[11px] shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]">
              ▶
            </span>
            <span className="truncate">Stream</span>
          </Link>
          <span className="border-ink-700 text-ink-500 ml-auto rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] uppercase">
            {brandBadge}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">{nav}</div>
        <div className="border-ink-800/80 shrink-0 border-t p-3">{footer}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-ink-800/80 bg-ink-950/90 sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            className="border-ink-800 text-ink-300 hover:bg-ink-850 grid size-9 place-items-center rounded-lg border"
            onClick={() => setMobileOpen(true)}
          >
            <HamburgerIcon />
          </button>
          <span className="text-sm font-semibold tracking-tight">
            {mobileTitle}
          </span>
        </header>

        <div className="bg-ink-950 relative flex-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,oklch(0.59_0.17_245/0.07),transparent_70%)]"
          />
          <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export function ShellNav({
  sections,
}: {
  sections: Array<{ title: string; items: ShellNavItem[] }>;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2.5 py-4">
      {sections.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="text-ink-500 px-2.5 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase">
            {section.title}
          </p>
          {section.items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={classNames(
                  "relative flex items-center rounded-md px-2.5 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-ink-850 text-ink-100 before:bg-brand-500 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full"
                    : "text-ink-500 hover:bg-ink-850/50 hover:text-ink-200",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function ShellUserCard({
  name,
  detail,
  onSignOut,
  extra,
}: {
  name: string;
  detail: string;
  onSignOut: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {extra}
      <div className="bg-ink-850/40 flex items-center gap-2.5 rounded-lg px-2 py-2">
        <div className="bg-ink-800 text-ink-300 ring-ink-700 grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-1">
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight font-medium">
            {name}
          </p>
          <p className="text-ink-500 truncate text-[11px]">{detail}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="text-ink-500 hover:bg-ink-850 hover:text-ink-200 w-full rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <p className="text-ink-500 text-[11px] font-semibold tracking-[0.1em] uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <div className="text-ink-500 max-w-xl text-sm">{description}</div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-ink-800/80 from-ink-900/80 to-ink-950/40 rounded-xl border bg-gradient-to-b px-4 py-3.5">
      <p className="text-ink-500 text-[10px] font-semibold tracking-[0.1em] uppercase">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="text-ink-500 mt-1 text-[11px]">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={classNames(
        "border-ink-800/80 bg-ink-900/25 overflow-hidden rounded-xl border",
        className,
      )}
    >
      {(title || action) && (
        <div className="border-ink-800/80 flex items-center justify-between gap-3 border-b px-4 py-3">
          {title && (
            <h2 className="text-ink-300 text-[12px] font-semibold tracking-[0.08em] uppercase">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
