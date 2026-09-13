import { normalizeSubtitlePayload } from "./media-selection";

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
      const response = await fetch(definition.src, { credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error(`Subtitle source returned ${response.status}. Try again or select another track.`);
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
