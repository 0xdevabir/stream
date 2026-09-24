import { randomUUID } from "node:crypto";

import {
  PRESENCE_HEARTBEAT_MS,
  type ServerMessage,
  clientMessageSchema,
} from "@stream/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

import { COOKIE } from "../auth/cookies";
import { verifyPlaybackToken } from "../auth/tokens";
import { canModerate } from "../services/access";
import * as chat from "../services/chat";
import * as events from "../services/events";
import { isPlaybackSessionActive, touchViewerSession } from "../services/playback";
import * as presence from "../services/presence";
import * as streams from "../services/streams";

/**
 * The live room socket: chat, Q&A, presence, and stream-status changes.
 *
 * Authorization reuses the playback cookie the watch page already obtained, so
 * a socket can never be opened for a class the viewer cannot watch. Fanout
 * goes through Redis (see services/events) so this works with any number of
 * API instances behind the edge.
 */
export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stream/:id", { websocket: true }, async (socket, request) => {
    const streamId = (request.params as { id: string }).id;
    const connectionId = randomUUID();

    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const fail = (code: string, message: string) => {
      send({ t: "error", code, message, fatal: true });
      socket.close(4001, code);
    };

    const stream = await streams.findStreamBySlugOrId(streamId);
    if (!stream) return fail("not_found", "Class not found");

    const context = {
      userId: request.auth?.userId ?? null,
      organizationId: request.auth?.organizationId ?? null,
      role: request.auth?.role ?? null,
    };
    const isModerator = canModerate(stream, context);

    // Moderators are admitted on their session alone; everyone else must
    // present the playback grant issued for this specific class.
    let viewerId = context.userId;
    let sessionJti: string | null = null;

    if (!isModerator) {
      const token = request.cookies[COOKIE.playback];
      const claims = token ? await verifyPlaybackToken(token) : null;

      if (
        !claims ||
        claims.streamId !== stream.id ||
        !(await isPlaybackSessionActive(claims.jti))
      ) {
        return fail("unauthorized", "No valid playback session for this class");
      }

      viewerId = claims.userId;
      sessionJti = claims.jti;
    }

    await presence.join(stream.id, connectionId);

    const unsubscribe = await events.subscribe(stream.id, send);

    send({
      t: "hello",
      viewerCount: await presence.count(stream.id),
      canModerate: isModerator,
      slowModeSeconds: stream.slowModeSeconds,
      paused: stream.status === "LIVE" && (await streams.isPaused(stream.id)),
      backlog: stream.chatEnabled
        ? await chat.listRecent({
            streamId: stream.id,
            instructorId: stream.instructorId,
            viewerId,
            limit: 50,
          })
        : [],
    });

    // Viewer count is broadcast on a timer rather than on every join/leave:
    // in a class of a thousand, per-event updates would be a fanout storm for
    // information nobody reads that precisely.
    const viewerTimer = setInterval(() => {
      void (async () => {
        const count = await presence.count(stream.id);
        send({ t: "viewers", count });
        if (isModerator) await streams.recordViewerPeak(stream.id, count);
      })();
    }, PRESENCE_HEARTBEAT_MS);

    let closed = false;
    const cleanup = async () => {
      if (closed) return;
      closed = true;

      clearInterval(viewerTimer);
      await unsubscribe();
      await presence.leave(stream.id, connectionId);
      if (sessionJti) await touchViewerSession(sessionJti, {});
    };

    socket.on("close", () => void cleanup());
    socket.on("error", () => void cleanup());

    socket.on("message", (raw: Buffer) => {
      void handleMessage(socket, raw);
    });

    async function handleMessage(_socket: WebSocket, raw: Buffer) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        return send({ t: "error", code: "bad_json", message: "Malformed message", fatal: false });
      }

      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        return send({
          t: "error",
          code: "bad_message",
          message: "Unrecognised message",
          fatal: false,
        });
      }

      const message = result.data;

      try {
        switch (message.t) {
          case "ping": {
            await presence.heartbeat(stream!.id, connectionId);
            return send({ t: "pong" });
          }

          case "chat": {
            if (!viewerId) {
              return send({
                t: "error",
                code: "unauthorized",
                message: "Sign in to take part in chat",
                fatal: false,
              });
            }
            const enabled =
              message.kind === "QUESTION"
                ? stream!.questionsEnabled
                : stream!.chatEnabled;
            if (!enabled) {
              return send({
                t: "error",
                code: "disabled",
                message: "That is turned off for this class",
                fatal: false,
              });
            }

            // Published to Redis by the service, which is what echoes it back
            // to this socket along with everyone else's.
            await chat.postMessage({
              streamId: stream!.id,
              instructorId: stream!.instructorId,
              userId: viewerId,
              body: message.body,
              kind: message.kind,
              slowModeSeconds: stream!.slowModeSeconds,
              isModerator,
              nonce: message.nonce,
            });
            return;
          }

          case "upvote":
          case "unvote": {
            if (!viewerId) return;
            await chat.vote(
              message.messageId,
              viewerId,
              stream!.instructorId,
              message.t === "upvote",
            );
            return;
          }

          case "moderate": {
            if (!isModerator) {
              return send({
                t: "error",
                code: "forbidden",
                message: "Only the instructor can moderate",
                fatal: false,
              });
            }
            await chat.moderate({
              messageId: message.messageId,
              action: message.action,
              moderatorId: viewerId!,
              instructorId: stream!.instructorId,
            });
            return;
          }

          case "slowmode": {
            if (!isModerator) {
              return send({
                t: "error",
                code: "forbidden",
                message: "Only the instructor can change slow mode",
                fatal: false,
              });
            }
            await chat.setSlowMode(stream!.id, message.seconds);
            return;
          }

          case "quality": {
            if (sessionJti) {
              await touchViewerSession(sessionJti, {
                maxRendition: message.rendition,
              });
            }
            return;
          }
        }
      } catch (error) {
        const known =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "error";
        const text =
          error instanceof Error ? error.message : "Something went wrong";

        send({ t: "error", code: known, message: text, fatal: false });
      }
    }
  });
}
