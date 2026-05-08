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

export function VideoJsPlayer({ src, className, subtitleTracks = [], poster }: VideoJsPlayerProps) {
  return (
    <div className={className}>
      <Player.Provider>
        <VideoSkin poster={poster} className="spilled-video-player">
          <Video src={src} playsInline>
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
