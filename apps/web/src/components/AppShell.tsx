"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Button, Spinner } from "@/components/ui";
import { classNames } from "@/lib/format";
import { useSession } from "@/lib/session";

/**
 * Signed-in chrome for the streaming provider developer console.
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
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
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

export function TopNav() {
  const { user, signOut } = useSession();
  const pathname = usePathname();

  return (
    <header className="border-ink-800 bg-ink-950/80 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-3">
        <Link
          href="/dashboard"
          className="mr-4 flex items-center gap-2 font-semibold"
        >
          <span className="bg-brand-600 grid size-7 place-items-center rounded-lg text-sm">
            ▶
          </span>
          <span className="hidden sm:inline">Stream</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={classNames(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                pathname === link.href || pathname.startsWith(`${link.href}/`)
                  ? "bg-ink-850 text-ink-100"
                  : "text-ink-500 hover:text-ink-100",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="group relative">
            <button
              type="button"
              className="bg-ink-800 text-ink-300 grid size-8 place-items-center rounded-full text-xs font-semibold"
              title={user?.email}
            >
              {initials(user?.name ?? "?")}
            </button>
            <div className="card invisible absolute right-0 mt-2 w-56 p-2 opacity-0 shadow-xl transition-all group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <p className="px-2 py-1 text-sm">{user?.name}</p>
              <p className="text-ink-500 truncate px-2 pb-2 text-xs">
                {user?.email}
              </p>
              <p className="text-ink-500 border-ink-800 border-t px-2 py-2 text-[11px] tracking-wide uppercase">
                {user?.organizationName}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
