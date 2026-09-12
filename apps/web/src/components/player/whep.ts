/**
 * A minimal WHEP client (WebRTC-HTTP Egress Protocol, RFC 9725).
 *
 * This is the sub-second path. It bypasses HLS entirely: the browser peers
 * directly with MediaMTX, which is why it is only offered for classes that
 * opted into ULTRA latency mode -- every WHEP viewer costs the origin a real
 * PeerConnection, whereas HLS viewers cost only bandwidth.
 *
 * Deliberately non-trickle: we gather ICE fully before sending the offer.
 * It adds a beat to connection setup and removes an entire class of PATCH /
 * session-state bugs, which is the right trade for a fallback path.
 */

export type WhepConnection = {
  readonly pc: RTCPeerConnection;
  close: () => Promise<void>;
};

export type WhepOptions = {
  /** `/webrtc/live/<streamId>/whep` from the playback grant. */
  url: string;
  /**
   * The playback grant. Sent as a query parameter because MediaMTX's auth hook
   * only sees the request's query string, not our HttpOnly cookie.
   */
  token: string | null;
  signal?: AbortSignal;
  onState?: (state: RTCPeerConnectionState) => void;
};

/** ICE gathering can stall on a bad network; a partial candidate set is better than none. */
const ICE_GATHER_TIMEOUT_MS = 3000;

export async function connectWhep(
  video: HTMLVideoElement,
  options: WhepOptions,
): Promise<WhepConnection> {
  const pc = new RTCPeerConnection({
    // MediaMTX advertises host candidates for the server; on a self-hosted
    // box both peers are usually reachable directly, so no STUN is required.
    // Operators behind NAT set WEBRTC_ADDITIONAL_HOSTS instead.
    iceServers: [],
    bundlePolicy: "max-bundle",
  });

  // WHEP is receive-only. Declaring the transceivers up front means the offer
  // already describes what we want, so MediaMTX can answer in one round trip.
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const stream = new MediaStream();
  pc.addEventListener("track", (event) => {
    stream.addTrack(event.track);
    if (video.srcObject !== stream) video.srcObject = stream;
  });

  if (options.onState) {
    const notify = options.onState;
    pc.addEventListener("connectionstatechange", () => notify(pc.connectionState));
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  // Absolute, because it is also the base for resolving the session URL below
  // and `new URL(relative, relativeBase)` throws.
  const endpoint = absoluteUrl(withToken(options.url, options.token));

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp ?? offer.sdp ?? "",
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    pc.close();
    throw error;
  }

  if (!response.ok) {
    pc.close();
    throw new Error(
      response.status === 403
        ? "Low-latency mode is not available for this class"
        : `WHEP handshake failed (${response.status})`,
    );
  }

  // The answer has been accepted by now, so a later throw would leave a live
  // PeerConnection nobody owns.
  let sessionUrl: string | null;
  try {
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });

    // The session resource we must DELETE on teardown. Without it MediaMTX
    // holds the PeerConnection open until its own timeout fires.
    const location = response.headers.get("Location");
    sessionUrl = location ? new URL(location, endpoint).toString() : null;
  } catch (cause) {
    pc.close();
    throw cause;
  }

  return {
    pc,
    close: async () => {
      pc.close();
      video.srcObject = null;
      if (!sessionUrl) return;
      try {
        await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin" });
      } catch {
        // Teardown is best-effort; the server times the session out anyway.
      }
    },
  };
}

function withToken(url: string, token: string | null): string {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Media paths are same-origin relative (`/webrtc/...`). Resolving them against
 * the page up front matters because the endpoint doubles as the base URL for
 * the session resource MediaMTX returns in `Location`, and `new URL` rejects a
 * relative base.
 */
function absoluteUrl(path: string): string {
  return new URL(path, window.location.href).toString();
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };

    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

/** Round-trip time to the origin, in milliseconds, or null if not yet known. */
export async function whepRoundTripMs(
  pc: RTCPeerConnection,
): Promise<number | null> {
  const stats = await pc.getStats();
  let rtt: number | null = null;

  stats.forEach((report) => {
    if (
      report.type === "candidate-pair" &&
      (report as RTCIceCandidatePairStats).state === "succeeded"
    ) {
      const value = (report as RTCIceCandidatePairStats).currentRoundTripTime;
      if (typeof value === "number") rtt = Math.round(value * 1000);
    }
  });

  return rtt;
}
