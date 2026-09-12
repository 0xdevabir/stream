"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * There is no marketing page: this is an internal tool for an organization.
 * The root simply routes you to wherever you belong.
 */
export default function IndexPage() {
  const router = useRouter();
  const { user, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/classes" : "/login");
  }, [loading, user, router]);

  return (
    <main className="grid min-h-dvh place-items-center">
      <Spinner className="text-ink-500 size-6" />
    </main>
  );
}
