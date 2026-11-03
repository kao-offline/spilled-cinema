import { useEffect, useRef, useState } from "react";
import type { ImportedShow } from "../lib/types";
import { fetchTrailerForShow } from "../lib/import-client";

type TrailerPlayer = { mute: () => void; playVideo: () => void; destroy: () => void };
type YoutubeApi = { Player: new (host: HTMLElement, options: {
  host: string; videoId: string; playerVars: Record<string, string | number>;
  events: { onReady: (event: { target: TrailerPlayer }) => void; onStateChange: (event: { data: number }) => void; onError: () => void };
}) => TrailerPlayer };
type YoutubeWindow = Window & { YT?: YoutubeApi; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YoutubeApi> | null = null;
function loadYoutubeApi() {
  const target = window as YoutubeWindow;
  if (target.YT?.Player) return Promise.resolve(target.YT);
  apiPromise ??= new Promise<YoutubeApi>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Trailer player unavailable")), 15000);
    const previousReady = target.onYouTubeIframeAPIReady;
    target.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timer);
      if (target.YT) resolve(target.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { window.clearTimeout(timer); reject(new Error("Trailer player unavailable")); };
    document.head.appendChild(script);
  }).catch((error) => { apiPromise = null; throw error; });
  return apiPromise;
}

export function SeriesAtmosphere({ show }: { show: ImportedShow }) {
  const [key, setKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [motion, setMotion] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let canceled = false;
    setKey(null); setPlaying(false);
    if (motion) void fetchTrailerForShow(show).then((value) => { if (!canceled) setKey(value); }).catch(() => {});
    return () => { canceled = true; };
  }, [show, motion]);
  useEffect(() => {
    let canceled = false;
    let player: TrailerPlayer | undefined;
    setPlaying(false);
    if (key && motion) void loadYoutubeApi().then((api) => {
      if (canceled || !host.current) return;
      const mount = document.createElement("div");
      host.current.replaceChildren(mount);
      player = new api.Player(mount, {
        host: "https://www.youtube-nocookie.com", videoId: key,
        playerVars: { autoplay: 1, loop: 1, playlist: key, controls: 0, disablekb: 1, fs: 0, playsinline: 1, origin: location.origin },
        events: {
          onReady: ({ target }) => { if (!canceled) { host.current?.querySelector("iframe")?.setAttribute("tabindex", "-1"); target.mute(); target.playVideo(); } },
          onStateChange: ({ data }) => { if (!canceled) setPlaying(data === 1); },
          onError: () => { if (!canceled) { setPlaying(false); setKey(null); } },
        },
      });
    }).catch(() => { if (!canceled) setPlaying(false); });
    return () => { canceled = true; player?.destroy(); };
  }, [key, motion]);
  return <>
    <div ref={host} className={`series-trailer ${playing ? "is-playing" : ""}`} aria-hidden="true" />
  </>;
}
