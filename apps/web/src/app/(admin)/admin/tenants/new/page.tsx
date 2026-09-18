"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, CopyField, Field, Input, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Created = {
  id: string;
  slug: string;
  apiKey: string;
  consoleEmail: string;
  consolePassword: string;
  note: string;
};

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [maxConcurrentLives, setMaxConcurrentLives] = useState("3");
  const [maxMinutesPerMonth, setMaxMinutesPerMonth] = useState("10000");
  const [consoleEmail, setConsoleEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name,
        maxConcurrentLives: Number(maxConcurrentLives),
        maxMinutesPerMonth: Number(maxMinutesPerMonth),
      };
      if (consoleEmail.trim()) body.consoleEmail = consoleEmail.trim();

      const result = await api.post<Created>("/v1/admin/tenants", body);
      setCreated(result);
    } catch (cause) {
      setError(errorMessage(cause, "Could not create tenant"));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tenant created
          </h1>
          <p className="text-ink-500 mt-1 text-sm">{created.note}</p>
        </div>
        <CopyField label="Tenant id" value={created.id} />
        <CopyField label="Slug" value={created.slug} />
        <CopyField label="API key" value={created.apiKey} />
        <CopyField label="Console email" value={created.consoleEmail} />
        <CopyField label="Console password" value={created.consolePassword} />
        <div className="flex gap-2">
          <Button onClick={() => router.push(`/admin/tenants/${created.id}`)}>
            Open tenant
          </Button>
          <Link
            href="/admin/tenants"
            className="bg-ink-800 hover:bg-ink-700 inline-flex items-center rounded-lg px-4 py-2 text-sm"
          >
            All tenants
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <p className="text-ink-500 text-xs">
          <Link href="/admin/tenants" className="hover:underline">
            Tenants
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Create tenant
        </h1>
        <p className="text-ink-500 mt-1 text-sm">
          Provisions org, API key, and a consumer console login.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        {error && <Alert>{error}</Alert>}
        <Field label="Name">
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme LMS"
          />
        </Field>
        <Field label="Max concurrent lives">
          <Input
            type="number"
            min={1}
            required
            value={maxConcurrentLives}
            onChange={(e) => setMaxConcurrentLives(e.target.value)}
          />
        </Field>
        <Field label="Max minutes / month">
          <Input
            type="number"
            min={1}
            required
            value={maxMinutesPerMonth}
            onChange={(e) => setMaxMinutesPerMonth(e.target.value)}
          />
        </Field>
        <Field label="Console email (optional)">
          <Input
            type="email"
            value={consoleEmail}
            onChange={(e) => setConsoleEmail(e.target.value)}
            placeholder="auto-generated if empty"
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          {busy ? <Spinner className="size-4" /> : null}
          Create
        </Button>
      </form>
    </div>
  );
}
