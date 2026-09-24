"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ClassForm, type ClassFormValues } from "@/components/ClassForm";
import { ShareLinkPanel } from "@/components/IngestPanel";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Section,
  Spinner,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { classNames, formatCount, toDateTimeLocalValue } from "@/lib/format";

type Enrollee = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

type Analytics = {
  currentViewers: number;
  peakViewers: number;
  totalSessions: number;
  uniqueViewers: number;
  chatMessages: number;
  questions: number;
  qualityDistribution: Array<{ rendition: string | null; viewers: number }>;
  startedAt: string | null;
  endedAt: string | null;
};

type Tab = "settings" | "students" | "analytics";

export default function ManageClassPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const streamId = params.id;

  const [tab, setTab] = useState<Tab>("settings");
  const [stream, setStream] = useState<StreamSummary | null>(null);
  const [values, setValues] = useState<ClassFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { stream: row } = await api.get<{ stream: StreamSummary }>(
        `/v1/streams/${streamId}`,
      );
      setStream(row);
      setValues({
        title: row.title,
        description: row.description ?? "",
        scheduledAt: toDateTimeLocalValue(row.scheduledAt),
        accessMode: row.accessMode,
        password: "",
        latencyMode: row.latencyMode,
        recordEnabled: row.recordEnabled,
        chatEnabled: row.chatEnabled,
        questionsEnabled: row.questionsEnabled,
      });
    } catch (cause) {
      setError(errorMessage(cause, "Could not load this class"));
    }
  }, [streamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/v1/streams/${streamId}`, {
        title: values.title,
        description: values.description,
        ...(values.scheduledAt
          ? { scheduledAt: new Date(values.scheduledAt).toISOString() }
          : {}),
        accessMode: values.accessMode,
        // An empty password field means "leave it as it is", not "clear it".
        ...(values.accessMode === "PASSWORD" && values.password
          ? { password: values.password }
          : {}),
        ...(values.accessMode !== "PASSWORD" ? { removePassword: true } : {}),
        latencyMode: values.latencyMode,
        recordEnabled: values.recordEnabled,
        chatEnabled: values.chatEnabled,
        questionsEnabled: values.questionsEnabled,
      });
      setNotice("Saved.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  const cancelClass = async () => {
    if (!confirm("Cancel this class? Students will no longer see it as upcoming.")) {
      return;
    }
    try {
      await api.del(`/v1/streams/${streamId}`);
      router.push("/classes");
    } catch (cause) {
      setError(errorMessage(cause, "Could not cancel the class"));
    }
  };

  if (!stream || !values) {
    return (
      <div className="grid place-items-center py-24">
        {error ? <Alert>{error}</Alert> : <Spinner className="text-ink-500 size-6" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/classes" className="text-ink-500 hover:text-ink-100 text-sm">
          ← Classes
        </Link>
        <h1 className="page-title">{stream.title}</h1>
        <StatusBadge status={stream.status} />
        <Link href={`/classes/${streamId}/studio`} className="ml-auto">
          <Button size="sm">
            {stream.status === "LIVE" ? "Control room" : "Go live"}
          </Button>
        </Link>
      </header>

      <nav className="border-ink-800 flex gap-1 border-b">
        {(["settings", "students", "analytics"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={classNames(
              "-mb-px border-b-2 px-3 py-2 text-sm capitalize transition-colors",
              tab === option
                ? "border-brand-500 text-ink-100"
                : "text-ink-500 hover:text-ink-300 border-transparent",
            )}
          >
            {option}
          </button>
        ))}
      </nav>

      {notice && <Alert tone="success">{notice}</Alert>}

      {tab === "settings" && (
        <div className="space-y-5">
          <Section title="Student link">
            <ShareLinkPanel
              slug={stream.slug}
              shareToken={null}
              accessMode={stream.accessMode}
            />
          </Section>

          <Section title="Details">
            <ClassForm
              values={values}
              onChange={setValues}
              onSubmit={() => void save()}
              submitLabel="Save changes"
              busy={busy}
              error={error}
            />
          </Section>

          {stream.status !== "CANCELLED" && (
            <Section
              title="Danger zone"
              className="border-live-500/30"
              aside={
                <Button
                  variant="danger"
                  size="sm"
                  disabled={stream.status === "LIVE"}
                  onClick={() => void cancelClass()}
                >
                  Cancel class
                </Button>
              }
            >
              <p className="text-ink-500 text-xs">
                {stream.status === "LIVE"
                  ? "End the broadcast before cancelling."
                  : "Recordings are kept."}
              </p>
            </Section>
          )}
        </div>
      )}

      {tab === "students" && <Students streamId={streamId} />}
      {tab === "analytics" && <AnalyticsPanel streamId={streamId} />}
    </div>
  );
}

function Students({ streamId }: { streamId: string }) {
  const [rows, setRows] = useState<Enrollee[]>([]);
  const [emails, setEmails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ enrollments: Enrollee[] }>(
        `/v1/streams/${streamId}/enrollments`,
      );
      setRows(data.enrollments);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load the roster"));
    }
  }, [streamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    // Accepts a paste from a spreadsheet: commas, spaces or newlines.
    const list = emails
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (list.length === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ enrolled: number; unknownEmails: string[] }>(
        `/v1/streams/${streamId}/enrollments`,
        { userIds: [], emails: list },
      );
      setEmails("");
      setNotice(
        result.unknownEmails.length > 0
          ? `Enrolled ${result.enrolled}. No account yet for: ${result.unknownEmails.join(", ")}`
          : `Enrolled ${result.enrolled}.`,
      );
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not enrol those students"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    try {
      await api.del(`/v1/streams/${streamId}/enrollments/${userId}`);
      setRows((current) => current.filter((row) => row.id !== userId));
    } catch (cause) {
      setError(errorMessage(cause, "Could not remove that student"));
    }
  };

  return (
    <div className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <Section title="Add students">
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Email addresses" hint="Separate with commas, spaces or new lines.">
              <Input
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                placeholder="student1@example.com, student2@example.com"
              />
            </Field>
          </div>
          <Button type="submit" loading={busy} className="sm:mb-5">
            Enrol
          </Button>
        </form>
      </Section>

      {rows.length === 0 ? (
        <EmptyState
          title="No students enrolled"
          body="Add students above, or switch this class to organization-wide access."
        />
      ) : (
        <Section title={`Enrolled (${rows.length})`} bodyClassName="p-0">
        <ul className="divide-ink-800 divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{row.name}</p>
                <p className="text-ink-500 truncate text-xs">{row.email}</p>
              </div>
              <button
                type="button"
                onClick={() => void remove(row.id)}
                className="text-ink-500 hover:text-live-500 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        </Section>
      )}
    </div>
  );
}

function AnalyticsPanel({ streamId }: { streamId: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .get<Analytics>(`/v1/streams/${streamId}/analytics`)
        .then(setData)
        .catch((cause: unknown) =>
          setError(errorMessage(cause, "Could not load analytics")),
        );

    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [streamId]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="text-ink-500 size-5" />
      </div>
    );
  }

  const totalQuality = data.qualityDistribution.reduce(
    (sum, row) => sum + row.viewers,
    0,
  );

  return (
    <div className="space-y-5">
      <Section title="Audience">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          <Stat label="Watching now" value={formatCount(data.currentViewers)} tone="good" />
          <Stat label="Peak viewers" value={formatCount(data.peakViewers)} />
          <Stat label="Unique viewers" value={formatCount(data.uniqueViewers)} />
          <Stat label="Sessions" value={formatCount(data.totalSessions)} />
          <Stat label="Chat messages" value={formatCount(data.chatMessages)} />
          <Stat label="Questions" value={formatCount(data.questions)} />
        </div>
      </Section>

      <Section title="Quality reached">
        {totalQuality === 0 ? (
          <p className="text-ink-500 text-xs">
            No data yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.qualityDistribution.map((row) => (
              <li key={row.rendition ?? "unknown"} className="flex items-center gap-3">
                <span className="text-ink-300 w-14 text-xs">
                  {row.rendition ?? "unknown"}
                </span>
                <div className="bg-ink-850 h-2 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-brand-500 h-full rounded-full"
                    style={{ width: `${(row.viewers / totalQuality) * 100}%` }}
                  />
                </div>
                <span className="text-ink-500 w-10 text-right text-xs">
                  {row.viewers}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
