"use client";

import type { SessionUser } from "@stream/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Logo } from "@/components/AppShell";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setUser } = useSession();

  // Arriving with an invite joins an existing organization; arriving without
  // one creates a new organization with this account as its owner.
  const inviteToken = params.get("invite");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    organizationName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { user } = await api.post<{ user: SessionUser }>("/v1/auth/register", {
        name: form.name,
        email: form.email,
        password: form.password,
        ...(inviteToken
          ? { inviteToken }
          : { organizationName: form.organizationName }),
      });
      setUser(user);
      router.replace("/classes");
    } catch (cause) {
      setError(errorMessage(cause, "Could not create the account"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo className="size-11" />
          <h1 className="text-3xl font-black">
            {inviteToken ? "Join your team" : "Create account"}
          </h1>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Alert>{error}</Alert>}

          <Field label="Your name">
            <Input required autoComplete="name" value={form.name} onChange={update("name")} />
          </Field>

          <Field label="Email">
            <Input
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={update("email")}
            />
          </Field>

          <Field label="Password" hint="At least 10 characters.">
            <Input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={form.password}
              onChange={update("password")}
            />
          </Field>

          {!inviteToken && (
            <Field label="Organization">
              <Input
                required
                value={form.organizationName}
                onChange={update("organizationName")}
              />
            </Field>
          )}

          <Button type="submit" loading={busy} className="w-full" size="lg">
            Create account
          </Button>

          <p className="text-ink-500 text-center text-xs">
            Already have one?{" "}
            <Link href="/login" className="text-brand-400 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
