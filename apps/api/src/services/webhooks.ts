import { lookup } from "node:dns/promises";

import {
  type Prisma,
  generateWebhookSecret,
  prisma,
  randomId,
  unwrapSecret,
  wrapSecret,
} from "@stream/db";
import type {
  CreateWebhookInput,
  CreatedWebhook,
  UpdateWebhookInput,
  WebhookDeliverySummary,
  WebhookEventType,
  WebhookSummary,
} from "@stream/shared";
import type { FastifyBaseLogger } from "fastify";

import { env } from "../env";
import { ApiError } from "../errors";
import { SIGNATURE_HEADER, isPublicAddress, signWebhookPayload } from "./webhook-signing";

/**
 * Outbound webhooks, delivered from a Postgres outbox.
 *
 * `emit` writes one WebhookDelivery row per subscribed endpoint in the same
 * breath as the state change that caused it, and a dispatcher loop in every
 * API process drains the table. Rows are claimed with FOR UPDATE SKIP LOCKED
 * plus a lease on `nextAttemptAt`, so replicas never double-send and a
 * process that dies mid-delivery simply lets the lease lapse for someone else
 * to retry. Delivery is at-least-once; receivers dedupe on the event id.
 */

/** Delay before retry N (1-based). Roughly a day in total, then give up. */
const BACKOFF_SECONDS = [30, 120, 600, 1_800, 7_200, 21_600, 43_200];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const TIMEOUT_MS = 10_000;
const POLL_MS = 2_000;
const BATCH = 20;
const RETENTION_DAYS = 30;

export type WebhookEventName = WebhookEventType | "ping";

export interface WebhookEvent {
  id: string;
  type: WebhookEventName;
  created: string;
  data: Record<string, unknown>;
}

// ── Emitting ───────────────────────────────────────────────────────────────

/**
 * Queues an event for every enabled endpoint in the organization that
 * subscribes to it. Never throws: a webhook problem must not fail the state
 * change (a class going live) that triggered it.
 */
export async function emit(
  organizationId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
  log?: FastifyBaseLogger,
): Promise<void> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        organizationId,
        enabled: true,
        OR: [{ events: { isEmpty: true } }, { events: { has: type } }],
      },
      select: { id: true },
    });
    if (endpoints.length === 0) return;

    const event = newEvent(type, data);
    await prisma.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        eventId: event.id,
        eventType: type,
        payload: event as unknown as Prisma.InputJsonValue,
        // Explicit rather than the column default: the dispatcher compares in UTC,
        // and CURRENT_TIMESTAMP on a timestamp column follows the session zone.
        nextAttemptAt: new Date(),
      })),
    });
    wake();
  } catch (error) {
    log?.error({ err: error, type, organizationId }, "webhooks: failed to queue event");
  }
}

function newEvent(type: WebhookEventName, data: Record<string, unknown>): WebhookEvent {
  return { id: `evt_${randomId(16)}`, type, created: new Date().toISOString(), data };
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;
let lastPrune = 0;
let logger: FastifyBaseLogger | null = null;

export function startDispatcher(log: FastifyBaseLogger): void {
  logger = log;
  stopped = false;
  schedule(POLL_MS);
}

export function stopDispatcher(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Runs a tick now rather than at the next poll; used right after `emit`. */
function wake(): void {
  if (!stopped && !running) schedule(0);
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), delay);
  timer.unref();
}

async function tick(): Promise<void> {
  if (stopped || running) return;
  running = true;
  try {
    let claimed: number;
    // Drain in batches while there is a backlog, then fall back to polling.
    do {
      claimed = await deliverBatch();
    } while (claimed === BATCH && !stopped);
    await pruneOccasionally();
  } catch (error) {
    logger?.error({ err: error }, "webhooks: dispatcher tick failed");
  } finally {
    running = false;
    if (!stopped) schedule(POLL_MS);
  }
}

async function deliverBatch(): Promise<number> {
  // Timestamps are stored as UTC `timestamp without time zone`.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "WebhookDelivery"
       SET "nextAttemptAt" = (now() AT TIME ZONE 'UTC') + interval '60 seconds', -- lease: hidden from other replicas while in flight
           "attempts" = "attempts" + 1
     WHERE "id" IN (
       SELECT "id" FROM "WebhookDelivery"
        WHERE "status" = 'PENDING'
          AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
        ORDER BY "nextAttemptAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  if (rows.length === 0) return 0;

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: { endpoint: true },
  });

  await Promise.allSettled(deliveries.map(attempt));
  return rows.length;
}

type DeliveryWithEndpoint = Prisma.WebhookDeliveryGetPayload<{
  include: { endpoint: true };
}>;

async function attempt(delivery: DeliveryWithEndpoint): Promise<void> {
  const { endpoint } = delivery;
  if (!endpoint.enabled) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", lastError: "Endpoint disabled" },
    });
    return;
  }

  const result = await send(
    endpoint.url,
    unwrapSecret(endpoint.secretWrapped, env.CONTENT_KEY_SECRET),
    delivery.id,
    delivery.eventType,
    JSON.stringify(delivery.payload),
  );

  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SUCCEEDED",
        responseStatus: result.status,
        lastError: null,
        deliveredAt: new Date(),
      },
    });
    return;
  }

  const exhausted = delivery.attempts >= MAX_ATTEMPTS;
  const delay = BACKOFF_SECONDS[Math.min(delivery.attempts, BACKOFF_SECONDS.length) - 1]!;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      responseStatus: result.status,
      lastError: result.error.slice(0, 500),
      ...(exhausted ? {} : { nextAttemptAt: new Date(Date.now() + delay * 1000) }),
    },
  });
}

type SendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string };

async function send(
  url: string,
  secret: string,
  deliveryId: string,
  eventType: string,
  body: string,
): Promise<SendResult> {
  try {
    await assertDeliverable(url);
  } catch (error) {
    return { ok: false, status: null, error: (error as Error).message };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Stream-Webhooks/1.0",
        "Stream-Event": eventType,
        "Stream-Delivery": deliveryId,
        [SIGNATURE_HEADER]: signWebhookPayload(secret, body),
      },
      body,
      // A redirect would bypass the address check above.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Drain so the socket can be reused; the content is not interesting.
    await response.body?.cancel().catch(() => undefined);

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status };
    }
    return { ok: false, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    const message =
      (error as Error).name === "TimeoutError"
        ? `Timed out after ${TIMEOUT_MS / 1000}s`
        : (error as Error).message;
    return { ok: false, status: null, error: message };
  }
}

/**
 * Production endpoints must be HTTPS on a public address. Development allows
 * anything, so a receiver on localhost or in the compose network works.
 *
 * The DNS check happens here, right before the request, but fetch resolves
 * again itself -- a hostile resolver could answer differently the second
 * time. Closing that gap needs a pinned-address agent; the check still stops
 * every plain misconfiguration and non-rebinding attack.
 */
async function assertDeliverable(rawUrl: string): Promise<void> {
  if (!env.isProduction) return;
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Webhook URL must use https");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new Error("Webhook URL resolves to a private address");
  }
}

async function pruneOccasionally(): Promise<void> {
  if (Date.now() - lastPrune < 3_600_000) return;
  lastPrune = Date.now();
  await prisma.webhookDelivery.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) },
      status: { not: "PENDING" },
    },
  });
}

// ── Management ─────────────────────────────────────────────────────────────

type EndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  createdAt: Date;
};

function serialize(row: EndpointRow): WebhookSummary {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

function validateUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw ApiError.badRequest("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw ApiError.badRequest("Webhook URL must be http(s)");
  }
  if (env.isProduction && url.protocol !== "https:") {
    throw ApiError.badRequest("Webhook URL must use https");
  }
  if (url.username || url.password) {
    throw ApiError.badRequest("Put credentials in your receiver, not the webhook URL");
  }
}

const MAX_ENDPOINTS = 10;

export async function listWebhooks(organizationId: string): Promise<WebhookSummary[]> {
  const rows = await prisma.webhookEndpoint.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(serialize);
}

export async function createWebhook(
  organizationId: string,
  input: { url: string; description?: string | undefined; events: CreateWebhookInput["events"] },
): Promise<CreatedWebhook> {
  validateUrl(input.url);
  const count = await prisma.webhookEndpoint.count({ where: { organizationId } });
  if (count >= MAX_ENDPOINTS) {
    throw ApiError.conflict(`An organization can have at most ${MAX_ENDPOINTS} webhook endpoints`);
  }

  const secret = generateWebhookSecret();
  const row = await prisma.webhookEndpoint.create({
    data: {
      organizationId,
      url: input.url,
      description: input.description ?? null,
      events: [...new Set(input.events ?? [])],
      secretWrapped: wrapSecret(secret, env.CONTENT_KEY_SECRET),
    },
  });
  return { ...serialize(row), secret };
}

async function requireEndpoint(organizationId: string, id: string) {
  const row = await prisma.webhookEndpoint.findFirst({ where: { id, organizationId } });
  if (!row) throw ApiError.notFound("Unknown webhook endpoint");
  return row;
}

export async function updateWebhook(
  organizationId: string,
  id: string,
  input: UpdateWebhookInput,
): Promise<WebhookSummary> {
  await requireEndpoint(organizationId, id);
  const row = await prisma.webhookEndpoint.update({
    where: { id },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.events !== undefined ? { events: [...new Set(input.events)] } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return serialize(row);
}

export async function deleteWebhook(organizationId: string, id: string): Promise<void> {
  await requireEndpoint(organizationId, id);
  await prisma.webhookEndpoint.delete({ where: { id } });
}

/** Queues a `ping` to one endpoint, regardless of its event filter. */
export async function sendTestEvent(organizationId: string, id: string): Promise<{ eventId: string }> {
  const endpoint = await requireEndpoint(organizationId, id);
  const event = newEvent("ping", { webhookId: endpoint.id });
  await prisma.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      eventId: event.id,
      eventType: event.type,
      payload: event as unknown as Prisma.InputJsonValue,
      // Explicit rather than the column default: the dispatcher compares in UTC,
      // and CURRENT_TIMESTAMP on a timestamp column follows the session zone.
      nextAttemptAt: new Date(),
    },
  });
  wake();
  return { eventId: event.id };
}

export async function listDeliveries(
  organizationId: string,
  id: string,
): Promise<WebhookDeliverySummary[]> {
  await requireEndpoint(organizationId, id);
  const rows = await prisma.webhookDelivery.findMany({
    where: { endpointId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
  }));
}

/** Makes a failed delivery due again, e.g. after the receiver was fixed. */
export async function retryDelivery(
  organizationId: string,
  endpointId: string,
  deliveryId: string,
): Promise<void> {
  await requireEndpoint(organizationId, endpointId);
  const { count } = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, endpointId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (count === 0) throw ApiError.notFound("No failed delivery with that id");
  wake();
}
