import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ACCESS_MODES,
  LATENCY_MODES,
  MESSAGE_KINDS,
  ORG_ROLES,
  RECORDING_STATUSES,
  STREAM_STATUSES,
  WEBHOOK_DELIVERY_STATUSES,
} from "@stream/shared";

/**
 * The web app reads enum values from `@stream/shared` while the API writes
 * them through Prisma. If the two lists drift, the mismatch surfaces as a
 * runtime constraint violation in production rather than a type error, so it
 * is worth a cheap test.
 *
 * We parse schema.prisma rather than the generated client: the schema is the
 * source of truth, and this keeps the test runnable before `prisma generate`.
 */
const SCHEMA = readFileSync(
  join(__dirname, "..", "prisma", "schema.prisma"),
  "utf8",
);

function enumValues(name: string): string[] {
  const match = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`, "m").exec(SCHEMA);
  assert.ok(match, `enum ${name} not found in schema.prisma`);
  return match[1]!
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
}

const CASES: Array<[string, readonly string[]]> = [
  ["OrgRole", ORG_ROLES],
  ["StreamStatus", STREAM_STATUSES],
  ["AccessMode", ACCESS_MODES],
  ["RecordingStatus", RECORDING_STATUSES],
  ["MessageKind", MESSAGE_KINDS],
  ["LatencyMode", LATENCY_MODES],
  ["WebhookDeliveryStatus", WEBHOOK_DELIVERY_STATUSES],
];

for (const [prismaName, sharedValues] of CASES) {
  test(`${prismaName} matches @stream/shared`, () => {
    assert.deepEqual(
      [...enumValues(prismaName)].sort(),
      [...sharedValues].sort(),
      `${prismaName} in schema.prisma has drifted from packages/shared/src/enums.ts`,
    );
  });
}
