"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui";
import { useSession } from "@/lib/session";

/** Console entry: signed-in users land on the dashboard. */
export default function IndexPage() {
  const router = useRouter();
  const { user, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, router]);

  return (
    <main className="grid min-h-dvh place-items-center">
      <Spinner className="text-ink-500 size-6" />
    </main>
  );
}
