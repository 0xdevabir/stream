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
 * Tenant / consumer console chrome.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useSession();
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
    <ShellFrame
      brandHref="/dashboard"
      brandBadge="Tenant"
      mobileTitle="Tenant console"
      nav={
        <ShellNav
          sections={[
            {
              title: "Streaming",
              items: [
                { href: "/dashboard", label: "Overview" },
                { href: "/live-inputs", label: "Live inputs" },
                { href: "/videos", label: "Videos" },
                { href: "/embed", label: "Embed & test" },
              ],
            },
            {
              title: "Access",
              items: [
                { href: "/api-keys", label: "API keys" },
                { href: "/webhooks", label: "Webhooks" },
                { href: "/usage", label: "Usage" },
                { href: "/settings", label: "Settings" },
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
          detail={user.organizationName}
          onSignOut={() => void signOut()}
          extra={
            user.platformAdmin ? (
              <Link
                href="/admin"
                className="border-ink-800 text-ink-400 hover:border-ink-700 hover:bg-ink-850 hover:text-ink-100 mb-1 flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[12px] transition-colors"
              >
                <span>Super admin</span>
                <span aria-hidden>→</span>
              </Link>
            ) : undefined
          }
        />
      }
    >
      {children}
    </ShellFrame>
  );
}
