"use client";

import type { AccessMode, LatencyMode } from "@stream/shared";
import { useState } from "react";

import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export type ClassFormValues = {
  title: string;
  description: string;
  scheduledAt: string;
  accessMode: AccessMode;
  password: string;
  latencyMode: LatencyMode;
  recordEnabled: boolean;
  chatEnabled: boolean;
  questionsEnabled: boolean;
};

export const EMPTY_CLASS: ClassFormValues = {
  title: "",
  description: "",
  scheduledAt: "",
  accessMode: "ENROLLED",
  password: "",
  latencyMode: "LOW",
  recordEnabled: true,
  chatEnabled: true,
  questionsEnabled: true,
};

const ACCESS_MODES: Array<{ value: AccessMode; label: string; hint: string }> = [
  {
    value: "ENROLLED",
    label: "Enrolled students only",
    hint: "Only people you add to this class can watch.",
  },
  {
    value: "ORG",
    label: "Anyone in the organization",
    hint: "Every signed-in member of your organization can watch.",
  },
  {
    value: "LINK",
    label: "Anyone with the private link",
    hint: "No sign-in required. The link contains an unguessable token.",
  },
  {
    value: "PASSWORD",
    label: "Password",
    hint: "Viewers type a shared password once, then watch.",
  },
  {
    value: "PUBLIC",
    label: "Public",
    hint: "Anyone who finds the URL can watch. Use sparingly.",
  },
];

const LATENCY_MODES: Array<{ value: LatencyMode; label: string; hint: string }> = [
  {
    value: "LOW",
    label: "Low (~3 seconds)",
    hint: "Encrypted HLS with adaptive quality. Scales to thousands of viewers on bandwidth alone.",
  },
  {
    value: "ULTRA",
    label: "Ultra (sub-second)",
    hint: "Also offers a WebRTC path for near-real-time interaction. Each ultra viewer costs the server a live connection, so keep the class small.",
  },
];

/**
 * Shared by the create and edit screens. Emitting plain values rather than a
 * request body keeps the "what changed" logic with the caller, which is the
 * only place that knows whether this is a create or a patch.
 */
export function ClassForm({
  values,
  onChange,
  onSubmit,
  submitLabel,
  busy,
  error,
  footer,
}: {
  values: ClassFormValues;
  onChange: (values: ClassFormValues) => void;
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  footer?: React.ReactNode;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = <K extends keyof ClassFormValues>(key: K, value: ClassFormValues[K]) =>
    onChange({ ...values, [key]: value });

  const accessHint = ACCESS_MODES.find((mode) => mode.value === values.accessMode)?.hint;
  const latencyHint = LATENCY_MODES.find((mode) => mode.value === values.latencyMode)?.hint;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-5"
    >
      {error && <Alert>{error}</Alert>}

      <Field label="Title">
        <Input
          required
          maxLength={200}
          placeholder="Lecture 7 — Virtual memory"
          value={values.title}
          onChange={(event) => set("title", event.target.value)}
        />
      </Field>

      <Field label="Description" hint="Optional. Shown to students before the class starts.">
        <Textarea
          rows={3}
          maxLength={5000}
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>

      <Field label="Scheduled start" hint="Optional. You can go live at any time regardless.">
        <Input
          type="datetime-local"
          value={values.scheduledAt}
          onChange={(event) => set("scheduledAt", event.target.value)}
        />
      </Field>

      <Field label="Who can watch" hint={accessHint}>
        <Select
          value={values.accessMode}
          onChange={(event) => set("accessMode", event.target.value as AccessMode)}
        >
          {ACCESS_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </Field>

      {values.accessMode === "PASSWORD" && (
        <Field label="Class password" hint="Shared with students out of band.">
          <Input
            required
            minLength={4}
            value={values.password}
            onChange={(event) => set("password", event.target.value)}
          />
        </Field>
      )}

      <button
        type="button"
        onClick={() => setShowAdvanced((value) => !value)}
        className="text-ink-500 hover:text-ink-100 text-xs"
      >
        {showAdvanced ? "Hide" : "Show"} latency and interaction settings
      </button>

      {showAdvanced && (
        <div className="border-ink-800 space-y-5 border-l-2 pl-4">
          <Field label="Latency mode" hint={latencyHint}>
            <Select
              value={values.latencyMode}
              onChange={(event) => set("latencyMode", event.target.value as LatencyMode)}
            >
              {LATENCY_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-3">
            <Checkbox
              label="Record this class"
              description="The replay is built from the live segments, so recording costs nothing extra."
              checked={values.recordEnabled}
              onChange={(event) => set("recordEnabled", event.target.checked)}
            />
            <Checkbox
              label="Live chat"
              checked={values.chatEnabled}
              onChange={(event) => set("chatEnabled", event.target.checked)}
            />
            <Checkbox
              label="Q&A queue"
              description="Students ask questions and upvote each other's; you mark them answered."
              checked={values.questionsEnabled}
              onChange={(event) => set("questionsEnabled", event.target.checked)}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" loading={busy} size="lg">
          {submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}
