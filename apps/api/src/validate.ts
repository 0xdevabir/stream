import type { FastifyRequest } from "fastify";
import type { ZodTypeAny, z } from "zod";

import { ApiError } from "./errors";

/**
 * Thin zod wrappers instead of a schema-to-JSON-Schema bridge.
 *
 * The contracts in `@stream/shared` are already zod and are shared with the
 * web app; running them directly keeps one source of truth and avoids a
 * translation layer whose failure modes are hard to debug.
 */
function parse<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
  location: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ApiError.badRequest(
      `Invalid ${location}`,
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function body<S extends ZodTypeAny>(
  schema: S,
  request: FastifyRequest,
): z.infer<S> {
  return parse(schema, request.body ?? {}, "request body");
}

export function query<S extends ZodTypeAny>(
  schema: S,
  request: FastifyRequest,
): z.infer<S> {
  return parse(schema, request.query ?? {}, "query string");
}

export function params<S extends ZodTypeAny>(
  schema: S,
  request: FastifyRequest,
): z.infer<S> {
  return parse(schema, request.params ?? {}, "path parameters");
}
