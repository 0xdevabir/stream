"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import {
  ShellFrame,
  ShellNav,
  ShellUserCard,
} from "@/components/console/layout";
import { Spinner } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Platform super-admin chrome.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!user.platformAdmin) {
      router.replace("/dashboard");
    }
  }, [loading, user, router, pathname]);

  if (loading || !user?.platformAdmin) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  return (
    <ShellFrame
      brandHref="/admin"
      brandBadge="Admin"
      mobileTitle="Super admin"
      nav={
        <ShellNav
          sections={[
            {
              title: "Platform",
              items: [
                { href: "/admin", label: "Overview", exact: true },
                { href: "/admin/tenants", label: "Tenants" },
                { href: "/admin/live", label: "Live inputs" },
                { href: "/admin/usage", label: "Usage" },
              ],
            },
            {
              title: "Docs",
              items: [
                { href: "/guides/integration", label: "Integration guide" },
              ],
            },
          ]}
        />
      }
      footer={
        <ShellUserCard
          name={user.name}
          detail={user.email}
          onSignOut={() => void signOut()}
          extra={
            <Link
              href="/dashboard"
              className="border-ink-800 text-ink-400 hover:border-ink-700 hover:bg-ink-850 hover:text-ink-100 mb-1 flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[12px] transition-colors"
            >
              <span>Tenant console</span>
              <span aria-hidden>→</span>
            </Link>
          }
        />
      }
    >
      {children}
    </ShellFrame>
  );
}
