"use client";

import type { SessionUser } from "@stream/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Spinner } from "@/components/ui";
import { classNames } from "@/lib/format";
import { canTeach, isOrgAdmin, useSession } from "@/lib/session";

/**
 * The signed-in chrome.
 *
 * Auth is enforced by the API on every call; this guard exists only so a
 * signed-out visitor lands on the sign-in page instead of watching five
 * requests fail.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6 sm:pt-10 md:pb-16">
        {children}
      </main>
      <TabBar />
    </div>
  );
}

// Enrolment is per-class rather than org-wide, so it lives on a class's
// manage screen instead of a top-level nav entry.
const LINKS = [
  { href: "/classes", label: "Classes", icon: ClassesIcon, adminOnly: false },
  { href: "/library", label: "Recordings", icon: RecordingsIcon, adminOnly: false },
  { href: "/developers", label: "Developers", icon: DevelopersIcon, adminOnly: true },
];

function visibleLinks(user: SessionUser | null) {
  return LINKS.filter((link) => !link.adminOnly || (canTeach(user) && isOrgAdmin(user)));
}

export function TopNav() {
  const { user } = useSession();
  const pathname = usePathname();
  const links = visibleLinks(user);
  const active = links.findIndex((link) => pathname.startsWith(link.href));

  return (
    <header className="material sticky top-0 z-30 border-b-[0.5px] border-white/[0.07] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6">
        <Link href="/classes" className="pressable flex min-w-0 items-center gap-2.5">
          <Logo className="size-8" />
          <span className="truncate text-[17px] font-semibold">
            {user?.organizationName ?? "Classes"}
          </span>
        </Link>

        {/* Desktop: a capsule switcher whose highlight glides between tabs. */}
        <nav
          className="bg-ink-850/80 absolute left-1/2 hidden -translate-x-1/2 rounded-full p-[3px] ring-[0.5px] ring-white/[0.06] md:grid"
          style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
        >
          {active >= 0 && (
            <span
              aria-hidden
              className="bg-thumb ease-ios absolute top-[3px] bottom-[3px] left-[3px] rounded-full shadow-[inset_0_0.5px_0_rgb(255_255_255/0.12),0_2px_6px_rgb(0_0_0/0.3)] transition-transform duration-400"
              style={{
                width: `calc((100% - 6px) / ${links.length})`,
                transform: `translateX(${active * 100}%)`,
              }}
            />
          )}
          {links.map((link, index) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={index === active ? "page" : undefined}
              className={classNames(
                "relative z-10 px-5 py-1.5 text-center text-[13px] whitespace-nowrap transition-colors",
                index === active
                  ? "text-ink-100 font-semibold"
                  : "text-ink-500 hover:text-ink-100 font-medium",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {canTeach(user) && (
            <Link
              href="/classes/new"
              aria-label="New class"
              className="pressable bg-beige text-on-brand grid size-9 place-items-center rounded-full"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Link>
          )}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * Mobile: a floating glass tab bar, lifted off the bottom edge and clear of
 * the home indicator. The selected tab sits in a lit capsule.
 */
function TabBar() {
  const { user } = useSession();
  const pathname = usePathname();
  const links = visibleLinks(user);

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="material pointer-events-auto flex w-full max-w-sm gap-1 rounded-full p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.7)] ring-[0.5px] ring-white/12">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={classNames(
                "ease-ios flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-[background-color,color,transform] duration-300 active:scale-95",
                active
                  ? "text-brand-400 bg-brand-500/15 shadow-[inset_0_0.5px_0_rgb(255_255_255/0.1)]"
                  : "text-ink-500 active:text-ink-300",
              )}
            >
              <Icon filled={active} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function AccountMenu() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="pressable bg-ink-850 text-ink-100 font-rounded grid size-9 place-items-center rounded-full text-[13px] font-semibold ring-[0.5px] ring-white/10"
      >
        {initials(user?.name ?? "?")}
      </button>
      {open && (
        <div className="material animate-pop-in absolute top-full right-0 mt-2 w-64 origin-top-right overflow-hidden rounded-[18px] shadow-[0_20px_60px_rgb(0_0_0/0.6)] ring-[0.5px] ring-white/10">
          <div className="px-4 py-3">
            <p className="truncate text-[15px] font-semibold">{user?.name}</p>
            <p className="text-ink-500 truncate text-[13px]">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-live-500 flex w-full items-center justify-between border-t-[0.5px] border-white/10 px-4 py-3.5 text-left text-[15px] transition-colors hover:bg-white/5 active:bg-white/10"
          >
            Sign out
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
              <path
                d="M10 11.5 13.5 8 10 4.5M13.5 8H6M7 2.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 13.5h3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/** The app mark: a charcoal play glyph on a sage squircle. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={classNames(
        "grid size-9 shrink-0 place-items-center rounded-[28%] bg-linear-to-b from-brand-400 to-brand-600 text-on-brand shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_14px_rgb(168_188_161/0.15)]",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="ml-[8%] size-[42%] fill-current">
        <path d="M4 2.5v11l9.5-5.5z" />
      </svg>
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Tab icons (SF Symbols-like, outline when idle, filled when selected) ───

function ClassesIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect
        x="2.75"
        y="5.25"
        width="13.5"
        height="13.5"
        rx="3"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m17.5 10 3.4-2.1a.7.7 0 0 1 1.1.6v7a.7.7 0 0 1-1.1.6L17.5 14z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RecordingsIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9.25"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M10 8.6v6.8l5.6-3.4z"
        fill={filled ? "var(--color-ink-950)" : "currentColor"}
      />
    </svg>
  );
}

function DevelopersIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
      <path
        d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"
        stroke="currentColor"
        strokeWidth={filled ? 2.2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
