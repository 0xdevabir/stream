"use client";

import { Button, Field, SegmentedControl, Select } from "@/components/ui";

import type { DeviceList } from "./whip";

export type CaptureSettings = {
  source: "camera" | "screen";
  cameraId: string;
  microphoneId: string;
  height: number;
};

/**
 * Capture heights offered to the instructor.
 *
 * This picks what leaves *their* machine, not what students receive — the
 * server always builds the full ladder from whatever arrives. The only reason
 * to send less is a constrained uplink.
 */
export const CAPTURE_HEIGHTS = [
  { value: 1080, label: "1080p", kbps: 4500 },
  { value: 720, label: "720p", kbps: 2800 },
  { value: 480, label: "480p", kbps: 1400 },
] as const;

export function SourcePanel({
  settings,
  onChange,
  devices,
  locked,
  previewing,
  onStartPreview,
  onStopPreview,
}: {
  settings: CaptureSettings;
  onChange: (settings: CaptureSettings) => void;
  devices: DeviceList;
  /** True while broadcasting: changing capture mid-class would drop the feed. */
  locked: boolean;
  previewing: boolean;
  onStartPreview: () => void;
  onStopPreview: () => void;
}) {
  const set = <K extends keyof CaptureSettings>(key: K, value: CaptureSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="space-y-4">
      <SegmentedControl
        value={settings.source}
        disabled={locked}
        onChange={(value) => set("source", value)}
        options={[
          { value: "camera", label: "Camera + mic" },
          { value: "screen", label: "Screen share" },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {settings.source === "camera" && (
          <Field label="Camera">
            <Select
              value={settings.cameraId}
              disabled={locked}
              onChange={(event) => set("cameraId", event.target.value)}
            >
              <option value="">System default</option>
              {devices.cameras.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Camera"}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Microphone">
          <Select
            value={settings.microphoneId}
            disabled={locked}
            onChange={(event) => set("microphoneId", event.target.value)}
          >
            <option value="">System default</option>
            {devices.microphones.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Microphone"}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Upload quality"
          hint="Students still get every rung of the ladder."
        >
          <Select
            value={settings.height}
            disabled={locked}
            onChange={(event) => set("height", Number(event.target.value))}
          >
            {CAPTURE_HEIGHTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.kbps / 1000} Mbps
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={locked} onClick={onStartPreview}>
          {previewing ? "Restart preview" : "Start preview"}
        </Button>
        {previewing && !locked && (
          <Button variant="ghost" size="sm" onClick={onStopPreview}>
            Stop preview
          </Button>
        )}
      </div>

      {locked && (
        <p className="text-ink-500 text-xs">
          Pause to change the source.
        </p>
      )}
    </div>
  );
}
