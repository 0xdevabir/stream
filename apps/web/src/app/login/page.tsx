"use client";

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
          <h1 className="text-xl font-semibold">Stream console</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Manage live inputs, API keys, and webhooks for your tenant.
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
            Tenants are provisioned by an operator. Self-serve signup is not
            enabled.
          </p>
        </form>
      </div>
    </main>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}
