/**
 * A minimal WHIP client (WebRTC-HTTP Ingestion Protocol, RFC 9725).
 *
 * This is the "one-click go live" path: the instructor's browser publishes
 * straight into MediaMTX, which the transcoder then pulls back over RTSP and
 * turns into the encrypted HLS ladder. No OBS, no install.
 *
 * The token is a short-lived publish grant rather than the class's stream key,
 * so the long-lived secret never has to reach the page.
 */

export type WhipSession = {
  readonly pc: RTCPeerConnection;
  /** Live upstream bitrate in bits per second, sampled from getStats(). */
  bitrate: () => Promise<number | null>;
  close: () => Promise<void>;
};

const ICE_GATHER_TIMEOUT_MS = 3000;

export async function publishWhip(
  stream: MediaStream,
  options: {
    url: string;
    token: string;
    /** Cap on the video encoder, in kilobits per second. */
    maxBitrateKbps: number;
    onState?: (state: RTCPeerConnectionState) => void;
  },
): Promise<WhipSession> {
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });

  for (const track of stream.getTracks()) {
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly",
      streams: [stream],
    });

    if (track.kind === "video") {
      const parameters = transceiver.sender.getParameters();
      // Firefox returns an empty encodings array before the first negotiation.
      parameters.encodings = parameters.encodings.length
        ? parameters.encodings
        : [{}];
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = options.maxBitrateKbps * 1000;
      }
      // Prefer dropping resolution over dropping frames: a lecturer's slides
      // stay readable when they soften, but a stuttering face is unwatchable.
      parameters.degradationPreference = "maintain-framerate";
      await transceiver.sender.setParameters(parameters);
    }
  }

  if (options.onState) {
    const notify = options.onState;
    pc.addEventListener("connectionstatechange", () => notify(pc.connectionState));
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  const separator = options.url.includes("?") ? "&" : "?";
  const endpoint = `${options.url}${separator}token=${encodeURIComponent(options.token)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? offer.sdp ?? "",
    credentials: "same-origin",
  });

  if (!response.ok) {
    pc.close();
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The server refused the publish request. Try reloading to get a fresh token."
        : `Could not start publishing (${response.status})`,
    );
  }

  await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });

  const location = response.headers.get("Location");
  const sessionUrl = location ? new URL(location, endpoint).toString() : null;

  let lastBytes = 0;
  let lastAt = 0;

  return {
    pc,
    bitrate: async () => {
      const stats = await pc.getStats();
      let bytes: number | null = null;

      stats.forEach((report) => {
        if (report.type === "outbound-rtp" && (report as RTCOutboundRtpStreamStats).kind === "video") {
          bytes = (report as RTCOutboundRtpStreamStats).bytesSent ?? null;
        }
      });

      if (bytes === null) return null;

      const now = performance.now();
      const elapsed = (now - lastAt) / 1000;
      const delta = bytes - lastBytes;
      lastBytes = bytes;
      lastAt = now;

      // The first sample has no interval to divide by.
      return elapsed > 0 && elapsed < 30 ? (delta * 8) / elapsed : null;
    },
    close: async () => {
      pc.close();
      if (!sessionUrl) return;
      try {
        await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin" });
      } catch {
        // Best effort; MediaMTX drops the session when the ICE agent dies.
      }
    },
  };
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

export type DeviceList = {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
};

/**
 * Device labels are hidden until the page holds a media permission, so this is
 * only meaningful after the first successful getUserMedia call.
 */
export async function listDevices(): Promise<DeviceList> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((device) => device.kind === "videoinput"),
    microphones: devices.filter((device) => device.kind === "audioinput"),
  };
}

export type CaptureRequest = {
  source: "camera" | "screen";
  cameraId?: string;
  microphoneId?: string;
  /** Target capture height; the encoder ladder is built server-side anyway. */
  height: number;
};

export async function capture(request: CaptureRequest): Promise<MediaStream> {
  if (request.source === "screen") {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 }, height: { ideal: request.height } },
      // Tab audio when the browser offers it; the microphone is mixed in below.
      audio: true,
    });

    const microphone = await navigator.mediaDevices
      .getUserMedia({
        audio: request.microphoneId
          ? { deviceId: { exact: request.microphoneId } }
          : true,
      })
      .catch(() => null);

    if (microphone) {
      // Screen shares without a voice-over are rarely what a teacher wants,
      // so the mic track is added alongside whatever the tab provided.
      for (const track of microphone.getAudioTracks()) display.addTrack(track);
    }

    return display;
  }

  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(request.cameraId ? { deviceId: { exact: request.cameraId } } : {}),
      height: { ideal: request.height },
      frameRate: { ideal: 30 },
    },
    audio: {
      ...(request.microphoneId
        ? { deviceId: { exact: request.microphoneId } }
        : {}),
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
}
