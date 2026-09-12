"use client";

import type { StreamSummary } from "@stream/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ClassForm,
  EMPTY_CLASS,
  type ClassFormValues,
} from "@/components/ClassForm";
import {
  IngestPanel,
  ShareLinkPanel,
  type IngestCredentials,
} from "@/components/IngestPanel";
import { Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type CreateResponse = {
  stream: StreamSummary;
  ingest: IngestCredentials;
  shareToken: string;
};

export default function NewClassPage() {
  const router = useRouter();
  const [values, setValues] = useState<ClassFormValues>(EMPTY_CLASS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResponse | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<CreateResponse>("/v1/streams", {
        title: values.title,
        ...(values.description ? { description: values.description } : {}),
        // `datetime-local` gives a local wall-clock string; converting here
        // means the API always receives an unambiguous instant.
        ...(values.scheduledAt
          ? { scheduledAt: new Date(values.scheduledAt).toISOString() }
          : {}),
        accessMode: values.accessMode,
        ...(values.accessMode === "PASSWORD" ? { password: values.password } : {}),
        latencyMode: values.latencyMode,
        recordEnabled: values.recordEnabled,
        chatEnabled: values.chatEnabled,
        questionsEnabled: values.questionsEnabled,
      });
      setCreated(response);
    } catch (cause) {
      setError(errorMessage(cause, "Could not create the class"));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">{created.stream.title}</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Your class is ready. Go live now or come back at the scheduled time.
          </p>
        </header>

        <div className="card space-y-5 p-5">
          <ShareLinkPanel
            slug={created.stream.slug}
            shareToken={created.shareToken}
            accessMode={created.stream.accessMode}
          />
        </div>

        <div className="card p-5">
          <IngestPanel ingest={created.ingest} />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            onClick={() => router.push(`/classes/${created.stream.id}/studio`)}
          >
            Go live from this browser
          </Button>
          <Link href={`/classes/${created.stream.id}/manage`}>
            <Button variant="secondary" size="lg">
              Manage students
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">New class</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Everything here can be changed later.
        </p>
      </header>

      <ClassForm
        values={values}
        onChange={setValues}
        onSubmit={submit}
        submitLabel="Create class"
        busy={busy}
        error={error}
        footer={
          <Link href="/classes" className="text-ink-500 hover:text-ink-100 text-sm">
            Cancel
          </Link>
        }
      />
    </div>
  );
}
