"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  Panel,
  StatCard,
} from "@/components/console/layout";
import { StatusPill } from "@/components/StatusPill";
import {
  Alert,
  Button,
  CopyField,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type TenantDetail = {
  id: string;
  name: string;
  slug: string;
  maxConcurrentLives: number;
  maxMinutesPerMonth: number;
  concurrentLive: number;
  liveMinutes: number;
  tokensIssued: number;
  videoCount: number;
  createdAt: string;
  apiKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }>;
  consoleUsers: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
  }>;
  liveInputs: Array<{
    id: string;
    name: string;
    status: string;
    recordEnabled: boolean;
    createdAt: string;
  }>;
};

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<TenantDetail | null>(null);
  const [name, setName] = useState("");
  const [maxConcurrentLives, setMaxConcurrentLives] = useState("");
  const [maxMinutesPerMonth, setMaxMinutesPerMonth] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [keyName, setKeyName] = useState("LMS");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await api.get<TenantDetail>(
          `/v1/admin/tenants/${id}`,
          signal,
        );
        setItem(data);
        setName(data.name);
        setMaxConcurrentLives(String(data.maxConcurrentLives));
        setMaxMinutesPerMonth(String(data.maxMinutesPerMonth));
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const saveLimits = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/v1/admin/tenants/${id}`, {
        name,
        maxConcurrentLives: Number(maxConcurrentLives),
        maxMinutesPerMonth: Number(maxMinutesPerMonth),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const addUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreatedPassword(null);
    try {
      const created = await api.post<{ password: string }>(
        `/v1/admin/tenants/${id}/console-users`,
        {
          name: userName,
          email: userEmail,
          password: userPassword,
        },
      );
      setCreatedPassword(created.password);
      setUserName("");
      setUserEmail("");
      setUserPassword("");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetPass = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreatedPassword(null);
    try {
      const result = await api.post<{ password: string }>(
        `/v1/admin/tenants/${id}/console-users/reset-password`,
        { email: resetEmail, password: resetPassword },
      );
      setCreatedPassword(result.password);
      setResetPassword("");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const createKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreatedKey(null);
    try {
      const created = await api.post<{ apiKey: string }>(
        `/v1/admin/tenants/${id}/api-keys`,
        { name: keyName },
      );
      setCreatedKey(created.apiKey);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!confirm("Revoke this API key?")) return;
    setBusy(true);
    try {
      await api.del(`/v1/admin/tenants/${id}/api-keys/${keyId}`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancelLive = async (liveId: string) => {
    if (!confirm("Cancel this live input?")) return;
    setBusy(true);
    try {
      await api.del(`/v1/admin/tenants/${id}/live_inputs/${liveId}`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="text-ink-500 size-6" />
      </div>
    );
  }

  if (!item) {
    return <Alert>{error ?? "Tenant not found"}</Alert>;
  }

  return (
    <div className="space-y-7">
      <div>
        <p className="text-ink-500 text-xs">
          <Link href="/admin/tenants" className="hover:underline">
            Tenants
          </Link>
          <span className="mx-1.5">/</span>
          <span className="font-mono">{item.slug}</span>
        </p>
        <h1 className="mt-1 text-[1.65rem] font-semibold tracking-tight">
          {item.name}
        </h1>
        <p className="text-ink-500 mt-1 text-sm">
          Created {new Date(item.createdAt).toLocaleString()}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {createdKey && (
        <Alert>
          <p className="mb-2 font-medium">API key (shown once)</p>
          <CopyField label="API key" value={createdKey} />
        </Alert>
      )}
      {createdPassword && (
        <Alert>
          <p className="mb-2 font-medium">Password (shown once)</p>
          <CopyField label="Password" value={createdPassword} />
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Live now" value={String(item.concurrentLive)} />
        <StatCard label="Live inputs" value={String(item.liveInputs.length)} />
        <StatCard label="Videos" value={String(item.videoCount)} />
        <StatCard
          label="Minutes (month)"
          value={String(Math.round(item.liveMinutes))}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveLimits} className="card space-y-4 p-5">
          <h2 className="text-sm font-medium">Limits</h2>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Max concurrent lives">
            <Input
              type="number"
              min={1}
              value={maxConcurrentLives}
              onChange={(e) => setMaxConcurrentLives(e.target.value)}
            />
          </Field>
          <Field label="Max minutes / month">
            <Input
              type="number"
              min={1}
              value={maxMinutesPerMonth}
              onChange={(e) => setMaxMinutesPerMonth(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={busy}>
            Save limits
          </Button>
        </form>

        <form onSubmit={createKey} className="card space-y-4 p-5">
          <h2 className="text-sm font-medium">Issue API key</h2>
          <Field label="Key name">
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy}>
            Create key
          </Button>
        </form>

        <form onSubmit={addUser} className="card space-y-4 p-5">
          <h2 className="text-sm font-medium">Add console user</h2>
          <Field label="Name">
            <Input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              required
              minLength={10}
            />
          </Field>
          <Button type="submit" loading={busy}>
            Add user
          </Button>
        </form>

        <form onSubmit={resetPass} className="card space-y-4 p-5">
          <h2 className="text-sm font-medium">Reset console password</h2>
          <Field label="Email">
            <Input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              required
              minLength={10}
            />
          </Field>
          <Button type="submit" loading={busy}>
            Reset password
          </Button>
        </form>
      </div>

      <Panel title="Console users">
        <ul className="divide-ink-800/80 divide-y text-sm">
          {item.consoleUsers.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <span>
                {u.name}{" "}
                <span className="text-ink-500 font-mono text-xs">{u.email}</span>
              </span>
              <span className="text-ink-500 text-xs">{u.role}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="API keys">
        <ul className="divide-ink-800/80 divide-y text-sm">
          {item.apiKeys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span>
                {key.name}{" "}
                <span className="text-ink-500 font-mono text-xs">
                  {key.keyPrefix}…
                </span>
                {key.revokedAt && (
                  <span className="text-live-500 ml-2 text-xs">revoked</span>
                )}
              </span>
              {!key.revokedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void revokeKey(key.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Live inputs">
        {item.liveInputs.length === 0 ? (
          <p className="text-ink-500 px-4 py-6 text-center text-sm">
            No live inputs for this tenant.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900/50 text-ink-500 text-[10px] tracking-[0.08em] uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {item.liveInputs.map((live) => (
                <tr key={live.id} className="border-ink-800/80 border-t">
                  <td className="px-4 py-3">
                    <p className="font-medium">{live.name}</p>
                    <p className="text-ink-600 font-mono text-[11px]">
                      {live.id}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={live.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(live.status === "LIVE" || live.status === "SCHEDULED") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void cancelLive(live.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
