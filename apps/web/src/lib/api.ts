/**
 * The browser's single door to the API.
 *
 * Everything is same-origin (nginx puts the web app and `/v1` behind one host)
 * so there is no base URL to configure and no CORS to negotiate. Auth rides on
 * HttpOnly cookies; the only thing the client has to do by hand is echo the
 * CSRF cookie back as a header on unsafe methods.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401. Used by the refresh call. */
  noRefresh?: boolean;
};

/**
 * Access tokens live 15 minutes. Rather than make every screen think about
 * that, a 401 triggers one refresh attempt and one replay of the request.
 * Concurrent 401s share a single refresh so a dashboard firing five requests
 * at once does not rotate the refresh token five times.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch("/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: csrfHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all observe
      // the same result before a new attempt can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

function csrfHeaders(): Record<string, string> {
  const token = readCookie("csrf");
  return token ? { "X-CSRF-Token": token } : {};
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!SAFE_METHODS.has(method)) Object.assign(headers, csrfHeaders());

  const send = () =>
    fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

  let response = await send();

  if (response.status === 401 && !options.noRefresh) {
    if (await refreshSession()) response = await send();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object"
        ? (payload.error as { code?: string; message?: string; details?: unknown })
        : null;

    throw new ApiError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? response.statusText ?? "Request failed",
      error?.details,
    );
  }

  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Turns an unknown thrown value into something safe to render. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
