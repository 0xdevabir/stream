"use client";

import {
  type ApiKeySummary,
  type CreatedApiKey,
  type CreatedWebhook,
  WEBHOOK_EVENT_TYPES,
  type WebhookDeliverySummary,
  type WebhookEventType,
  type WebhookSummary,
} from "@stream/shared";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Button,
  Checkbox,
  CopyField,
  EmptyState,
  Field,
  Input,
  Section,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { classNames, formatRelative } from "@/lib/format";
import { isOrgAdmin, useSession } from "@/lib/session";

/**
 * Where an organization admin wires the platform into their own product:
 * API keys for their backend, webhook endpoints for lifecycle events, and a
 * copy-paste starting point for the embeddable player. Secrets are shown
 * exactly once, at creation; the API never returns them again.
 */
export default function DevelopersPage() {
  const { user } = useSession();

  if (!isOrgAdmin(user)) {
    return (
      <EmptyState
        title="Admins only"
        body="API keys and webhooks are managed by organization admins."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Developers</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Create classes from your own backend, embed the player in your site,
          and get notified when classes go live or recordings are ready. See{" "}
          <code className="text-ink-300">docs/api.md</code> for the full
          reference.
        </p>
      </header>

      <ApiKeys />
      <Webhooks />
      <Quickstart />
    </div>
  );
}

// ── API keys ────────────────────────────────────────────────────────────────

function ApiKeys() {
  const [items, setItems] = useState<ApiKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const load = useCallback(() => {
    api
      .get<{ items: ApiKeySummary[] }>("/v1/developer/api-keys")
      .then((data) => setItems(data.items))
      .catch((cause: unknown) => setError(errorMessage(cause, "Could not load API keys")));
  }, []);

  useEffect(load, [load]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const key = await api.post<CreatedApiKey>("/v1/developer/api-keys", { name });
      setCreated(key);
      setName("");
      load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not create the key"));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(key: ApiKeySummary) {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working within 30 seconds.`)) {
      return;
    }
    try {
      await api.del(`/v1/developer/api-keys/${key.id}`);
      load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not revoke the key"));
    }
  }

  return (
    <Section
      title="API keys"
      description="For server-to-server calls. A key acts as the admin who created it, and stops working if that person stops being an admin."
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {created && (
          <Alert tone="success">
            <div className="space-y-2">
              <p>Copy this key now. It will not be shown again.</p>
              <CopyField label={created.name} value={created.key} />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </Alert>
        )}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="min-w-56 flex-1">
            <Field label="New key name">
              <Input
                required
                maxLength={80}
                placeholder="e.g. LMS production"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" loading={creating}>
            Create key
          </Button>
        </form>

        {items === null ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="text-ink-500 text-sm">No API keys yet.</p>
        ) : (
          <ul className="divide-ink-800 divide-y">
            {items.map((key) => (
              <li key={key.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{key.name}</p>
                  <p className="text-ink-500 text-xs">
                    <code>{key.prefix}…</code> · by {key.createdBy.name} ·{" "}
                    {key.lastUsedAt ? `used ${formatRelative(key.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void revoke(key)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ── Webhooks ────────────────────────────────────────────────────────────────

function Webhooks() {
  const [items, setItems] = useState<WebhookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ items: WebhookSummary[] }>("/v1/developer/webhooks")
      .then((data) => setItems(data.items))
      .catch((cause: unknown) => setError(errorMessage(cause, "Could not load webhooks")));
  }, []);

  useEffect(load, [load]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const endpoint = await api.post<CreatedWebhook>("/v1/developer/webhooks", { url, events });
      setCreated(endpoint);
      setUrl("");
      setEvents([]);
      load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not add the endpoint"));
    } finally {
      setCreating(false);
    }
  }

  async function act(action: () => Promise<unknown>, failure: string) {
    setError(null);
    try {
      await action();
      load();
    } catch (cause) {
      setError(errorMessage(cause, failure));
    }
  }

  return (
    <Section
      title="Webhooks"
      description="We POST a signed JSON event to your URL when a class goes live, ends, or its recording is ready. Failed deliveries are retried for about a day."
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {created && (
          <Alert tone="success">
            <div className="space-y-2">
              <p>
                Copy the signing secret now. It will not be shown again. Use it to
                verify the <code>Stream-Signature</code> header.
              </p>
              <CopyField label="Signing secret" value={created.secret} />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </Alert>
        )}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field label="Endpoint URL">
            <Input
              type="url"
              required
              placeholder="https://example.com/webhooks/stream"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <div>
            <span className="label">Events (none selected means all)</span>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENT_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  label={type}
                  checked={events.includes(type)}
                  onChange={(event) =>
                    setEvents((current) =>
                      event.target.checked
                        ? [...current, type]
                        : current.filter((value) => value !== type),
                    )
                  }
                />
              ))}
            </div>
          </div>
          <Button type="submit" loading={creating}>
            Add endpoint
          </Button>
        </form>

        {items === null ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="text-ink-500 text-sm">No webhook endpoints yet.</p>
        ) : (
          <ul className="divide-ink-800 divide-y">
            {items.map((endpoint) => (
              <li key={endpoint.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={classNames("truncate font-medium", !endpoint.enabled && "text-ink-500")}>
                      {endpoint.url}
                    </p>
                    <p className="text-ink-500 text-xs">
                      {endpoint.events.length === 0 ? "All events" : endpoint.events.join(", ")}
                      {!endpoint.enabled && " · disabled"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void act(
                        () => api.post(`/v1/developer/webhooks/${endpoint.id}/test`),
                        "Could not send a test event",
                      ).then(() => setOpenId(endpoint.id))
                    }
                  >
                    Send test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpenId(openId === endpoint.id ? null : endpoint.id)}
                  >
                    {openId === endpoint.id ? "Hide log" : "Deliveries"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void act(
                        () =>
                          api.patch(`/v1/developer/webhooks/${endpoint.id}`, {
                            enabled: !endpoint.enabled,
                          }),
                        "Could not update the endpoint",
                      )
                    }
                  >
                    {endpoint.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete the endpoint ${endpoint.url}?`)) {
                        void act(
                          () => api.del(`/v1/developer/webhooks/${endpoint.id}`),
                          "Could not delete the endpoint",
                        );
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
                {openId === endpoint.id && <Deliveries endpointId={endpoint.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function Deliveries({ endpointId }: { endpointId: string }) {
  const [items, setItems] = useState<WebhookDeliverySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ items: WebhookDeliverySummary[] }>(`/v1/developer/webhooks/${endpointId}/deliveries`)
      .then((data) => setItems(data.items))
      .catch((cause: unknown) => setError(errorMessage(cause, "Could not load deliveries")));
  }, [endpointId]);

  // Deliveries land within seconds, so refresh while the log is open.
  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <div className="mt-2"><Alert>{error}</Alert></div>;
  if (items === null) return <Loading />;
  if (items.length === 0) {
    return <p className="text-ink-500 mt-2 text-xs">No deliveries yet.</p>;
  }

  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {items.map((delivery) => (
          <tr key={delivery.id} className="border-ink-850 border-t">
            <td className="py-1.5 pr-2">
              <span
                className={classNames(
                  "rounded px-1.5 py-0.5",
                  delivery.status === "SUCCEEDED" && "bg-emerald-500/15 text-emerald-300",
                  delivery.status === "PENDING" && "bg-amber-500/15 text-amber-300",
                  delivery.status === "FAILED" && "bg-live-500/15 text-live-500",
                )}
              >
                {delivery.status.toLowerCase()}
              </span>
            </td>
            <td className="py-1.5 pr-2 font-mono">{delivery.eventType}</td>
            <td className="text-ink-500 py-1.5 pr-2">
              {delivery.responseStatus ?? "—"} · {delivery.attempts} attempt
              {delivery.attempts === 1 ? "" : "s"}
              {delivery.lastError && delivery.status !== "SUCCEEDED" && ` · ${delivery.lastError}`}
            </td>
            <td className="text-ink-500 py-1.5 text-right">{formatRelative(delivery.createdAt)}</td>
            <td className="py-1.5 pl-2 text-right">
              {delivery.status === "FAILED" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api
                      .post(`/v1/developer/webhooks/${endpointId}/deliveries/${delivery.id}/retry`)
                      .then(load)
                      .catch((cause: unknown) => setError(errorMessage(cause, "Could not retry")))
                  }
                >
                  Retry
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Quickstart ──────────────────────────────────────────────────────────────

function Quickstart() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = `# 1. Create a class from your backend
curl -X POST ${origin}/v1/streams \\
  -H "Authorization: Bearer $STREAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Algebra 101","accessMode":"ENROLLED"}'

# 2. When one of your users opens the class page, mint an embed token
curl -X POST ${origin}/v1/streams/<id>/embed-tokens \\
  -H "Authorization: Bearer $STREAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ttlSeconds":7200}'

# 3. Render the returned embedUrl in an iframe
<iframe src="<embedUrl>" allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen style="width:100%;aspect-ratio:16/9;border:0"></iframe>`;

  return (
    <Section
      title="Quickstart"
      description="Mint embed tokens on your server, never in the browser: the API key must stay secret."
    >
      <pre className="bg-ink-950 border-ink-800 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed">
        {snippet}
      </pre>
    </Section>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-6">
      <Spinner className="text-ink-500 size-5" />
    </div>
  );
}
