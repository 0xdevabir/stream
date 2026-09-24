"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Button, Spinner } from "@/components/ui";
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
      <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:pt-12">{children}</main>
    </div>
  );
}

// Enrolment is per-class rather than org-wide, so it lives on a class's
// manage screen instead of a top-level nav entry.
const LINKS = [
  { href: "/classes", label: "Classes", teachOnly: false, adminOnly: false },
  { href: "/library", label: "Recordings", teachOnly: false, adminOnly: false },
  { href: "/developers", label: "Developers", teachOnly: true, adminOnly: true },
];

export function TopNav() {
  const { user, signOut } = useSession();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="bg-ink-900/70 border-ink-800/80 mx-auto flex h-14 w-full max-w-6xl items-center gap-1 rounded-full border px-2.5 backdrop-blur-md sm:h-16 sm:px-4">
        <Link href="/classes" className="mr-2 flex items-center gap-2.5 sm:mr-4">
          <Logo />
          <span className="hidden text-sm font-black tracking-tight md:inline">
            {user?.organizationName ?? "Classes"}
          </span>
        </Link>

        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {LINKS.filter(
            (link) =>
              (!link.teachOnly || canTeach(user)) && (!link.adminOnly || isOrgAdmin(user)),
          ).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={classNames(
                "rounded-full px-3 py-2 text-[13px] font-bold whitespace-nowrap transition-colors sm:px-4",
                pathname.startsWith(link.href)
                  ? "bg-brand-500/20 text-ink-100"
                  : "text-ink-500 hover:text-ink-100",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {canTeach(user) && (
            <Link href="/classes/new" className="hidden sm:block">
              <Button size="sm">New class</Button>
            </Link>
          )}
          <div className="group relative">
            <button
              type="button"
              className="bg-ink-800 text-ink-100 hover:bg-ink-700 grid size-9 place-items-center rounded-full text-xs font-bold transition-colors"
              aria-label="Account"
            >
              {initials(user?.name ?? "?")}
            </button>
            {/* The padding bridges the gap so the menu survives the pointer crossing it. */}
            <div className="invisible absolute right-0 pt-2 opacity-0 transition-all group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <div className="card w-60 p-2 shadow-2xl shadow-black/50">
                <p className="px-3 pt-2 text-sm font-bold">{user?.name}</p>
                <p className="text-ink-500 truncate px-3 pb-3 text-xs">{user?.email}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => void signOut()}
                >
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/** A sage disc with a play notch — the mark used across the app. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={classNames(
        "bg-brand-500 text-ink-950 grid size-9 shrink-0 place-items-center rounded-full",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="ml-0.5 size-3.5 fill-current">
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
