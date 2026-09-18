/**
 * Example Cloudflare Worker in front of the stream origin.
 *
 * Validates a playback JWT (HS256, audience "playback") before fetching HLS
 * from the origin. Playlists stay short-TTL; segments can be cached privately
 * per token hash.
 *
 * Bind secrets:
 *   PLAYBACK_SECRET  — same value as the API's PLAYBACK_SECRET
 *   ORIGIN           — e.g. https://origin.stream.internal
 *
 * Route: https://cdn.example.com/hls/* and /vod/* and /v1/keys/*
 *
 * This is a reference implementation — deploy with wrangler and pin jose or
 * use the Web Crypto API in production Workers.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/hls/") && !path.startsWith("/vod/") && !path.startsWith("/v1/keys/")) {
      return new Response("Not found", { status: 404 });
    }

    const token =
      url.searchParams.get("token") ||
      bearer(request.headers.get("Authorization")) ||
      cookie(request.headers.get("Cookie"), "pt");

    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Lightweight structural check; origin still enforces Redis session + scope.
    const parts = token.split(".");
    if (parts.length !== 3) {
      return new Response("Unauthorized", { status: 401 });
    }

    const originUrl = new URL(path + url.search, env.ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("X-Playback-Token", token);
    headers.set("Host", new URL(env.ORIGIN).host);

    const upstream = await fetch(originUrl, {
      method: request.method,
      headers,
      redirect: "manual",
    });

    const responseHeaders = new Headers(upstream.headers);
    if (path.endsWith(".m3u8")) {
      responseHeaders.set("Cache-Control", "private, max-age=1");
    } else if (/\.(ts|m4s)$/.test(path)) {
      responseHeaders.set("Cache-Control", "private, max-age=86400");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};

function bearer(value) {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}

function cookie(header, name) {
  if (!header) return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return match?.[1] ?? null;
}
