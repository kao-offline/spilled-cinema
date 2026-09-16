import { normalizeSubtitlePayload } from "./media-selection";

const MAX_TRANSIENT_SUBTITLE_ATTEMPTS = 3;
const SUBTITLE_RETRY_DELAY_MS = 350;

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryUrl(source: string, attempt: number) {
  if (attempt === 0 || source.startsWith("blob:")) return source;
  try {
    const url = new URL(source, typeof window === "undefined" ? "http://localhost/" : window.location.href);
    // A failed proxy response must not be reused while the upstream is warming up.
    url.searchParams.set("spilled_subtitle_retry", String(attempt));
    return url.href;
  } catch {
    return source;
  }
}

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, SUBTITLE_RETRY_DELAY_MS);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Owns one selected native track. Caption failures never touch the media source. */
export function loadSubtitleTrack(
  video: HTMLVideoElement,
  definition: { id: string; src: string; label: string; srclang: string },
  callbacks: { onError: (message: string) => void; onReady?: () => void },
) {
  const controller = new AbortController();
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.default = true; // Required by Safari when using custom video controls.
  track.label = definition.label;
  track.srclang = definition.srclang;
  track.dataset.subtitleId = definition.id;
  let disposed = false;
  let failed = false;
  let objectUrl: string | undefined;
  const fail = (message: string) => {
    if (disposed || failed) return;
    failed = true;
    track.track.mode = "disabled";
    callbacks.onError(message);
  };
  const timer = setTimeout(() => {
    fail("Subtitle loading timed out. Try again or select another track.");
    controller.abort();
  }, 20_000);
  track.addEventListener("load", () => {
    if (disposed || failed) return;
    clearTimeout(timer);
    if (!track.track.cues?.length) {
      fail("This subtitle file contains no readable captions.");
      return;
    }
    track.track.mode = "showing";
    callbacks.onReady?.();
  });
  track.addEventListener("error", () => {
    clearTimeout(timer);
    fail("The browser could not read this subtitle track. Select another track or turn subtitles off.");
  });

  void (async () => {
    try {
      let response: Response | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_TRANSIENT_SUBTITLE_ATTEMPTS; attempt += 1) {
        try {
          const candidate = await fetch(retryUrl(definition.src, attempt), { credentials: "omit", signal: controller.signal });
          if (candidate.ok || !isRetryableStatus(candidate.status) || attempt === MAX_TRANSIENT_SUBTITLE_ATTEMPTS - 1) {
            response = candidate;
            break;
          }
          lastError = new Error(`Subtitle source returned ${candidate.status}.`);
        } catch (error) {
          lastError = error;
          if (controller.signal.aborted || attempt === MAX_TRANSIENT_SUBTITLE_ATTEMPTS - 1) throw error;
        }
        await waitForRetry(controller.signal);
      }
      if (!response?.ok) {
        throw lastError instanceof Error
          ? lastError
          : new Error(`Subtitle source returned ${response?.status ?? "an unknown error"}. Try again or select another track.`);
      }
      const payload = await response.text();
      if (disposed || failed) return;
      const normalized = normalizeSubtitlePayload(payload);
      objectUrl = URL.createObjectURL(new Blob([normalized], { type: "text/vtt" }));
      track.src = objectUrl;
      video.appendChild(track);
      // Loading must be enabled even when the track arrives after loadedmetadata.
      track.track.mode = "showing";
    } catch (error) {
      clearTimeout(timer);
      fail(error instanceof Error ? error.message : "Subtitles could not be loaded.");
    }
  })();

  return () => {
    disposed = true;
    clearTimeout(timer);
    controller.abort();
    track.track.mode = "disabled";
    track.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
