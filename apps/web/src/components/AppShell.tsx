"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button, Spinner } from "@/components/ui";
import { classNames } from "@/lib/format";
import { useSession } from "@/lib/session";

/**
 * Signed-in chrome for the streaming provider developer console.
 * Dashboard layout: persistent sidebar + main content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  return (
    <div className="bg-ink-950 min-h-dvh lg:flex">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={classNames(
          "border-ink-800 bg-ink-900 fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-ink-800 bg-ink-950/90 sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            className="border-ink-800 text-ink-300 hover:bg-ink-850 rounded-lg border px-2.5 py-1.5 text-sm"
            onClick={() => setMobileOpen(true)}
          >
            Menu
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="bg-brand-600 grid size-6 place-items-center rounded-md text-xs">
              ▶
            </span>
            Stream
          </Link>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/live-inputs", label: "Live inputs" },
  { href: "/videos", label: "Videos" },
  { href: "/api-keys", label: "API keys" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/usage", label: "Usage" },
  { href: "/embed", label: "Embed" },
];

function Sidebar() {
  const { user, signOut } = useSession();
  const pathname = usePathname();

  return (
    <>
      <div className="border-ink-800 flex items-center gap-2.5 border-b px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 font-semibold">
          <span className="bg-brand-600 grid size-7 place-items-center rounded-lg text-sm">
            ▶
          </span>
          <span>Stream</span>
        </Link>
        <span className="text-ink-500 ml-auto text-[10px] tracking-wide uppercase">
          Console
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        <p className="text-ink-500 px-2.5 pb-2 text-[10px] font-medium tracking-wide uppercase">
          Manage
        </p>
        {LINKS.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={classNames(
                "rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-ink-850 text-ink-100"
                  : "text-ink-500 hover:bg-ink-850/60 hover:text-ink-100",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-ink-800 space-y-3 border-t p-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="bg-ink-800 text-ink-300 grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
            {initials(user?.name ?? "?")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight">{user?.name}</p>
            <p className="text-ink-500 truncate text-[11px]">
              {user?.organizationName}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-ink-500 w-full justify-start"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
