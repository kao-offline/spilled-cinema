import { createPlayer } from "@videojs/react";
import { VideoSkin, Video, videoFeatures } from "@videojs/react/video";
import "@videojs/react/video/skin.css";

type SubtitleTrack = {
  src: string;
  label: string;
  srclang: string;
  default?: boolean;
};

type VideoJsPlayerProps = {
  src: string;
  className?: string;
  subtitleTracks?: SubtitleTrack[];
  poster?: string;
};

const Player = createPlayer({ features: videoFeatures });

function getSourceType(src: string) {
  if (/\/api\/download-full\/browser-file\?/i.test(src)) {
    try {
      const parsed = new URL(src, window.location.origin);
      const proxiedUrl = parsed.searchParams.get("url") ?? "";
      const name = parsed.searchParams.get("name") ?? "";
      if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(proxiedUrl) || /\.mp4$/i.test(name)) return "video/mp4";
      if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(proxiedUrl) || /\.m3u8$/i.test(name)) return "application/x-mpegURL";
    } catch {
      return undefined;
    }
  }
  if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(src)) return "application/x-mpegURL";
  if (/\.mp4(?:$|[?#])|\/get_video\?|\/api\/download-full\/file\?/i.test(src)) return "video/mp4";
  return undefined;
}

export function VideoJsPlayer({ src, className, subtitleTracks = [], poster }: VideoJsPlayerProps) {
  const sourceType = getSourceType(src);

  return (
    <div className={className}>
      <Player.Provider>
        <VideoSkin poster={poster} className="spilled-video-player">
          <Video playsInline>
            <source src={src} type={sourceType} />
            {subtitleTracks.map((track, index) => (
              <track
                key={`${track.src}-${index}`}
                kind="subtitles"
                src={track.src}
                label={track.label}
                srcLang={track.srclang}
                default={Boolean(track.default)}
              />
            ))}
          </Video>
        </VideoSkin>
      </Player.Provider>
    </div>
  );
}
