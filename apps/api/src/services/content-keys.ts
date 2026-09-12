import { prisma, unwrapContentKey } from "@stream/db";

import { env } from "../env";

/**
 * Delivery of AES-128 content keys.
 *
 * This is the real access gate for media. Segments sit on disk and in object
 * storage as ciphertext; a player that cannot fetch the key holds bytes it
 * cannot decode. The edge's auth_request is a cheap first filter, but this
 * endpoint is the one that actually has to be right.
 *
 * Keys are stored wrapped (AES-256-GCM under CONTENT_KEY_SECRET) and unwrapped
 * only here, per request.
 */

export interface ContentKeyRecord {
  streamId: string;
  keyId: string;
  key: Buffer;
}

export async function findContentKeyById(
  contentKeyId: string,
): Promise<ContentKeyRecord | null> {
  const stream = await prisma.stream.findUnique({
    where: { contentKeyId },
    select: { id: true, contentKeyId: true, contentKeyWrapped: true },
  });
  if (!stream) return null;

  return {
    streamId: stream.id,
    keyId: stream.contentKeyId,
    key: unwrapContentKey(
      Buffer.from(stream.contentKeyWrapped),
      env.CONTENT_KEY_SECRET,
    ),
  };
}

export async function getContentKeyForStream(
  streamId: string,
): Promise<ContentKeyRecord | null> {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { id: true, contentKeyId: true, contentKeyWrapped: true },
  });
  if (!stream) return null;

  return {
    streamId: stream.id,
    keyId: stream.contentKeyId,
    key: unwrapContentKey(
      Buffer.from(stream.contentKeyWrapped),
      env.CONTENT_KEY_SECRET,
    ),
  };
}
