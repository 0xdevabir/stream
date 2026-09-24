import { createHmac, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

/**
 * Webhook signatures, in the Stripe style receivers already know:
 *
 *   Stream-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 *
 * Binding the timestamp into the MAC lets a receiver reject replays by
 * refusing anything older than a few minutes. `verifyWebhookSignature` is the
 * reference implementation quoted in docs/api.md.
 */

export const SIGNATURE_HEADER = "Stream-Signature";

export function signWebhookPayload(
  secret: string,
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = new Map(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isInteger(timestamp) || !signature) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

// ── SSRF guard ─────────────────────────────────────────────────────────────

/**
 * Webhook URLs are customer-supplied and fetched from inside our network, so
 * without this an endpoint pointed at http://postgres:5432 or the cloud
 * metadata service would turn the dispatcher into a proxy.
 */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // IPv4-mapped (::ffff:10.0.0.1) must be judged as the IPv4 it wraps.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return !PRIVATE.check(mapped[1]!, "ipv4");
    return !PRIVATE.check(address, "ipv6");
  }
  return !PRIVATE.check(address, "ipv4");
}
