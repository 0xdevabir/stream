import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { env } from "./env";

/**
 * Every failure the client is allowed to see goes through here, so responses
 * have one shape (`{ error: { code, message, details? } }`) and nothing
 * accidentally leaks a stack trace or a Prisma error string.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "bad_request", message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "unauthorized", message);
  }

  static forbidden(message = "You do not have access to this resource") {
    return new ApiError(403, "forbidden", message);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, "not_found", message);
  }

  static conflict(message: string, details?: unknown) {
    return new ApiError(409, "conflict", message, details);
  }

  static tooManyRequests(message = "Too many requests") {
    return new ApiError(429, "rate_limited", message);
  }

  static unavailable(message: string) {
    return new ApiError(503, "unavailable", message);
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: "not_found", message: `No route for ${request.method} ${request.url}` },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      // 4xx are the client's problem and are noisy at info level.
      if (error.statusCode >= 500) request.log.error({ err: error }, error.code);
      else request.log.debug({ err: error }, error.code);

      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "validation_failed",
          message: "Request did not match the expected shape",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }

    // Fastify's own errors (body too large, malformed JSON, rate limit) carry
    // a usable statusCode; anything else is ours and is a genuine bug.
    const statusCode = statusCodeOf(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, "unhandled error");
    }

    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? "internal_error" : "bad_request",
        // An unexpected 500 can carry a query fragment or a file path in its
        // message, so it is only echoed outside production.
        message:
          statusCode >= 500 && env.isProduction
            ? "Something went wrong"
            : messageOf(error),
      },
    });
  });
}

function statusCodeOf(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
