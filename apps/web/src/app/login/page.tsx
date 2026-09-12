"use client";

import Link from "next/link";
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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, user } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `next` is where the user was headed before the guard bounced them here.
  // Only relative paths are honoured -- an open redirect here would hand an
  // attacker a phishing page on our own domain.
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, router, next]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace(next);
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
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Live classes, recordings and Q&amp;A.
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Alert>{error}</Alert>}

          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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

          <p className="text-ink-500 text-center text-xs">
            No account?{" "}
            <Link href="/register" className="text-brand-400 hover:underline">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/classes";
  return value;
}
