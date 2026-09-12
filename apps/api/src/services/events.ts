import { type ServerMessage, streamChannel } from "@stream/shared";

import { redis, redisSubscriber } from "../redis";

/**
 * Room fanout across API instances.
 *
 * A viewer's WebSocket is attached to whichever API process happened to accept
 * it, so a chat message posted on instance A has to reach sockets on instance
 * B. Redis pub/sub is the whole mechanism: publish once, every instance with
 * subscribers in that room delivers to its own sockets.
 *
 * Each process keeps exactly one Redis subscription per active room, and drops
 * it when its last local socket leaves.
 */

type Handler = (message: ServerMessage) => void;

const handlers = new Map<string, Set<Handler>>();
let listening = false;

function ensureListener(): void {
  if (listening) return;
  listening = true;

  redisSubscriber.on("message", (channel, payload) => {
    const room = handlers.get(channel);
    if (!room || room.size === 0) return;

    let message: ServerMessage;
    try {
      message = JSON.parse(payload) as ServerMessage;
    } catch {
      return;
    }

    for (const handler of room) {
      // One misbehaving socket must not stop delivery to the rest of the room.
      try {
        handler(message);
      } catch {
        // Intentionally swallowed; the socket layer logs its own failures.
      }
    }
  });
}

export async function publish(
  streamId: string,
  message: ServerMessage,
): Promise<void> {
  await redis.publish(streamChannel(streamId), JSON.stringify(message));
}

export async function subscribe(
  streamId: string,
  handler: Handler,
): Promise<() => Promise<void>> {
  ensureListener();

  const channel = streamChannel(streamId);
  let room = handlers.get(channel);

  if (!room) {
    room = new Set();
    handlers.set(channel, room);
    await redisSubscriber.subscribe(channel);
  }
  room.add(handler);

  return async () => {
    room.delete(handler);
    if (room.size === 0) {
      handlers.delete(channel);
      await redisSubscriber.unsubscribe(channel).catch(() => undefined);
    }
  };
}
