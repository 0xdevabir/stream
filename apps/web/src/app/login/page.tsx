"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Alert, Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Matches packages/db/prisma/seed.ts — for local/demo stacks only. */
const DEMO_PASSWORD = "changeme-please";
const DEMO_STREAMER = {
  label: "Streamer",
  email: "instructor@example.com",
};
const DEMO_USERS = [1, 2, 3, 4, 5].map((n) => ({
  label: `User ${n}`,
  email: `student${n}@example.com`,
}));

const showDemoLogins =
  process.env.NEXT_PUBLIC_DEMO_LOGINS === "1" ||
  process.env.NODE_ENV === "development";

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
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

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

  const quickLogin = async (demoEmail: string) => {
    setDemoBusy(demoEmail);
    setError(null);
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    try {
      await signIn(demoEmail, DEMO_PASSWORD);
      router.replace(next);
    } catch (cause) {
      setError(errorMessage(cause, "Could not sign in"));
    } finally {
      setDemoBusy(null);
    }
  };

  const anyBusy = busy || demoBusy !== null;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
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

          <Button type="submit" loading={busy} disabled={anyBusy} className="w-full" size="lg">
            Sign in
          </Button>

          <p className="text-ink-500 text-center text-xs">
            No account?{" "}
            <Link href="/register" className="text-brand-400 hover:underline">
              Create one
            </Link>
          </p>
        </form>

        {showDemoLogins && (
          <div className="card mt-4 space-y-3 p-4">
            <div>
              <p className="text-ink-100 text-sm font-medium">Quick demo login</p>
              <p className="text-ink-500 mt-0.5 text-xs">
                Seeded accounts · password{" "}
                <span className="text-ink-300 font-mono">{DEMO_PASSWORD}</span>
              </p>
            </div>

            <Button
              type="button"
              variant="live"
              size="sm"
              className="w-full"
              disabled={anyBusy}
              loading={demoBusy === DEMO_STREAMER.email}
              onClick={() => void quickLogin(DEMO_STREAMER.email)}
            >
              {DEMO_STREAMER.label}
            </Button>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DEMO_USERS.map((demo) => (
                <Button
                  key={demo.email}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={anyBusy}
                  loading={demoBusy === demo.email}
                  onClick={() => void quickLogin(demo.email)}
                  title={demo.email}
                >
                  {demo.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/classes";
  return value;
}

