"use client";

import type { SessionUser } from "@stream/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function homeFor(user: SessionUser): string {
  return user.platformAdmin ? "/admin" : "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, user } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nextParam = params.get("next");

  useEffect(() => {
    if (!user) return;
    const next = safeNext(nextParam, user);
    router.replace(next);
  }, [user, router, nextParam]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signedIn = await signIn(email, password);
      router.replace(safeNext(nextParam, signedIn));
    } catch (cause) {
      setError(errorMessage(cause, "Could not sign in"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="bg-brand-600 mx-auto mb-3 grid size-10 place-items-center rounded-xl">
            ▶
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Stream</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Sign in to the platform admin or your tenant console.
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6 shadow-[0_0_0_1px_oklch(1_0_0/0.03)]">
          {error && <Alert>{error}</Alert>}

          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="console@example.com"
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button type="submit" loading={busy} className="w-full" size="lg">
            Sign in
          </Button>

          <div className="text-ink-500 space-y-1 border-t border-ink-800 pt-3 text-center text-[11px]">
            <p>
              Admin →{" "}
              <span className="text-ink-400 font-mono">/admin</span>
              {" · "}
              Tenant →{" "}
              <span className="text-ink-400 font-mono">/dashboard</span>
            </p>
            <p>
              <a href="/guides/integration" className="text-ink-300 underline">
                Integration guide
              </a>
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}

function safeNext(value: string | null, user: SessionUser): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    if (value.startsWith("/admin") && !user.platformAdmin) {
      return "/dashboard";
    }
    return value;
  }
  return homeFor(user);
}
