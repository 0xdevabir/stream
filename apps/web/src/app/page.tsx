"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui";
import { useSession } from "@/lib/session";

/** Entry: platform admins → /admin; tenants → /dashboard; else → /login */
export default function IndexPage() {
  const router = useRouter();
  const { user, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(user.platformAdmin ? "/admin" : "/dashboard");
  }, [loading, user, router]);

  return (
    <main className="grid min-h-dvh place-items-center">
      <Spinner className="text-ink-500 size-6" />
    </main>
  );
}
