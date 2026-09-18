import { type Prisma, prisma } from "@stream/db";

export type UsageKind =
  | "LIVE_MINUTE"
  | "TOKEN_ISSUED"
  | "ENCODE_LEASE"
  | "DELIVERED_BYTES_EST";

export async function recordUsage(input: {
  tenantId: string;
  streamId?: string;
  kind: UsageKind;
  quantity: number;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.usageEvent.create({
    data: {
      tenantId: input.tenantId,
      streamId: input.streamId ?? null,
      kind: input.kind,
      quantity: input.quantity,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function summarizeUsage(
  tenantId: string,
  since: Date,
): Promise<{ liveMinutes: number; tokensIssued: number }> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["kind"],
    where: { tenantId, createdAt: { gte: since } },
    _sum: { quantity: true },
  });

  const map = new Map(rows.map((row) => [row.kind, row._sum.quantity ?? 0]));
  return {
    liveMinutes: map.get("LIVE_MINUTE") ?? 0,
    tokensIssued: map.get("TOKEN_ISSUED") ?? 0,
  };
}

export async function countConcurrentLives(tenantId: string): Promise<number> {
  return prisma.stream.count({
    where: { tenantId, status: { in: ["LIVE", "PROCESSING", "SCHEDULED"] } },
  });
}

/** Called periodically while a stream is LIVE to bill encode minutes. */
export async function tickLiveMinute(
  tenantId: string,
  streamId: string,
): Promise<void> {
  await recordUsage({
    tenantId,
    streamId,
    kind: "LIVE_MINUTE",
    quantity: 1,
  });
}
