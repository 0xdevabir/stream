import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer integration guide",
};

/**
 * Public LMS / consumer integration guide.
 */
export default function IntegrationGuidePage() {
  return (
    <main className="bg-ink-950 text-ink-100 min-h-dvh">
      <div className="border-ink-800 border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="bg-brand-600 grid size-7 place-items-center rounded-lg text-sm">
              ▶
            </span>
            Stream
          </Link>
          <Link
            href="/login"
            className="text-ink-500 hover:text-ink-100 text-sm"
          >
            Sign in
          </Link>
        </div>
      </div>

      <article className="prose-invert mx-auto max-w-3xl space-y-8 px-4 py-12 text-sm leading-relaxed">
        <header className="space-y-2">
          <p className="text-ink-500 text-[11px] tracking-wide uppercase">
            Developers
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Integration guide
          </h1>
          <p className="text-ink-400 text-base">
            Wire your LMS (or any backend) to Stream for live streaming and
            recording. Students never log into Stream — your app mints playback
            tokens after you check enrollment.
          </p>
        </header>

        <Section title="Architecture">
          <ul className="text-ink-300 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink-100">Your LMS backend</strong> calls{" "}
              <code className="text-brand-400">/v1/provider/*</code> with an API
              key.
            </li>
            <li>
              <strong className="text-ink-100">Instructors</strong> publish with
              OBS (RTMP/SRT) or WHIP using ingest credentials from a live input.
            </li>
            <li>
              <strong className="text-ink-100">Students</strong> play HLS in your
              page using a short-lived signed URL / token.
            </li>
            <li>
              <strong className="text-ink-100">Tenant console</strong> (
              <code className="text-brand-400">/dashboard</code>) is for your
              ops team — keys, webhooks, test player.
            </li>
          </ul>
        </Section>

        <Section title="1. Get credentials">
          <p className="text-ink-300">
            A platform admin creates your tenant (Super admin → Tenants → Create)
            and gives you:
          </p>
          <ul className="text-ink-300 list-disc space-y-1 pl-5">
            <li>
              <code className="text-brand-400">STREAM_API_KEY</code> — server
              only, never in the browser
            </li>
            <li>
              <code className="text-brand-400">STREAM_BASE_URL</code> — e.g.{" "}
              <code>http://localhost:8080</code> or{" "}
              <code>https://stream.example.com</code>
            </li>
            <li>Optional console login for the tenant dashboard</li>
          </ul>
        </Section>

        <Section title="2. Create a live input">
          <pre className="border-ink-800 bg-ink-900 overflow-x-auto rounded-xl border p-4 font-mono text-xs">
            {`curl -sS -X POST "$STREAM_BASE_URL/v1/provider/live_inputs" \\
  -H "Authorization: Bearer $STREAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"CS101 Lecture 4","record":true}'`}
          </pre>
          <p className="text-ink-300 mt-3">
            Response includes <code>id</code> and{" "}
            <code>ingest.rtmp</code> / <code>srt</code> / <code>whip</code>.
            Store the live input id on your class/session row.
          </p>
        </Section>

        <Section title="3. Instructor publishes">
          <p className="text-ink-300">
            In OBS: Settings → Stream → Service <em>Custom</em>. Paste RTMP
            server + stream key. Keyframe interval 1s recommended.
          </p>
        </Section>

        <Section title="4. Mint a viewer token (after YOUR enrollment check)">
          <pre className="border-ink-800 bg-ink-900 overflow-x-auto rounded-xl border p-4 font-mono text-xs">
            {`curl -sS -X POST \\
  "$STREAM_BASE_URL/v1/provider/live_inputs/$ID/token" \\
  -H "Authorization: Bearer $STREAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ttlSeconds":3600}'`}
          </pre>
          <p className="text-ink-300 mt-3">
            Use <code>signedHlsUrl</code> (or <code>token</code> +{" "}
            <code>hlsUrl</code>) in your player. Prefer 15–60 minute TTLs.
          </p>
        </Section>

        <Section title="5. Embed with hls.js">
          <p className="text-ink-300">
            AES key requests must carry the same token (query or{" "}
            <code>Authorization: Bearer</code>). Example:
          </p>
          <pre className="border-ink-800 bg-ink-900 mt-3 overflow-x-auto rounded-xl border p-4 font-mono text-xs">
            {`const signedUrl = "...master.m3u8?token=...";
const token = new URL(signedUrl).searchParams.get("token");
const hls = new Hls({
  xhrSetup(xhr) {
    xhr.setRequestHeader("Authorization", \`Bearer \${token}\`);
  },
});
hls.loadSource(signedUrl);
hls.attachMedia(video);`}
          </pre>
          <p className="text-ink-300 mt-3">
            Full sample:{" "}
            <code>examples/lms-integration/</code> and{" "}
            <Link href="/embed" className="text-brand-400 underline">
              /embed
            </Link>{" "}
            in the tenant console.
          </p>
        </Section>

        <Section title="Provider API summary">
          <div className="border-ink-800 overflow-hidden rounded-xl border">
            <table className="w-full text-left text-xs">
              <thead className="bg-ink-900 text-ink-500">
                <tr>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Path</th>
                </tr>
              </thead>
              <tbody className="text-ink-300">
                {[
                  ["POST", "/v1/provider/live_inputs"],
                  ["GET", "/v1/provider/live_inputs/:id"],
                  ["POST", "/v1/provider/live_inputs/:id/token"],
                  ["DELETE", "/v1/provider/live_inputs/:id"],
                  ["GET", "/v1/provider/videos/:id"],
                  ["GET", "/v1/provider/usage"],
                  ["POST", "/v1/provider/webhooks"],
                ].map(([method, path]) => (
                  <tr key={path} className="border-ink-800 border-t">
                    <td className="px-3 py-2 font-mono">{method}</td>
                    <td className="px-3 py-2 font-mono">{path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-ink-500 mt-3 text-xs">
            Webhooks: <code>live.started</code>, <code>live.ended</code>,{" "}
            <code>video.ready</code>, <code>video.failed</code>.
          </p>
        </Section>

        <Section title="Localhost + your LMS">
          <ul className="text-ink-300 list-disc space-y-1 pl-5">
            <li>
              Stream on <code>:8080</code>, LMS on another port is fine.
            </li>
            <li>API key stays on the LMS server; browser only gets tokens.</li>
            <li>
              Keep <code>PUBLIC_BASE_URL</code> aligned with the URL browsers use
              for HLS.
            </li>
            <li>
              If the player is blocked cross-origin, proxy{" "}
              <code>/hls</code> through your LMS or ask for CORS on the origin.
            </li>
          </ul>
        </Section>

        <Section title="Who signs in where">
          <ul className="text-ink-300 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink-100">Super admin</strong> —{" "}
              <code>admin@example.com</code> →{" "}
              <Link href="/admin" className="text-brand-400 underline">
                /admin
              </Link>{" "}
              (tenants, quotas)
            </li>
            <li>
              <strong className="text-ink-100">Tenant / consumer</strong> —{" "}
              <code>console@example.com</code> →{" "}
              <Link href="/dashboard" className="text-brand-400 underline">
                /dashboard
              </Link>{" "}
              (inputs, keys, embed)
            </li>
            <li>
              <strong className="text-ink-100">Students</strong> — only your LMS
            </li>
          </ul>
        </Section>

        <p className="text-ink-500 text-xs">
          Also see <code>docs/integration.md</code>,{" "}
          <code>docs/provider.md</code>, and <code>docs/embed.md</code> in the
          repo.
        </p>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
