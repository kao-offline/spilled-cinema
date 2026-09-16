import { useState } from "react";
import { Check, Play, X } from "lucide-react";
import type { LibraryEpisode } from "../lib/types";
import { formatEpisodeTitle } from "../lib/episode-title";
import { episodeCodeLabel, episodeProgressPercent, type SeasonGroup } from "../lib/tv-episodes";

type TvEpisodePickerProps = {
  seasons: SeasonGroup[];
  initialSeason: number | null;
  currentEpisodeId: string;
  onPick: (episode: LibraryEpisode) => void;
  onClose: () => void;
};

/**
 * Lean-back episode switching inside the player. Replaces the desktop 3D
 * carousel: season pills on top, one big row per episode, one remote stop
 * each. No per-episode watched/download micro-buttons — rows just play.
 */
export function TvEpisodePicker({ seasons, initialSeason, currentEpisodeId, onPick, onClose }: TvEpisodePickerProps) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const activeSeason = selectedSeason ?? initialSeason ?? seasons[0]?.[0] ?? null;
  const activeEpisodes = seasons.find(([season]) => season === activeSeason)?.[1] ?? [];

  return (
    <aside className="tv-pick pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-[min(100vw,44rem)] flex-col bg-gradient-to-l from-black/95 via-black/70 to-transparent pl-[clamp(2rem,6vw,5rem)] pr-4" aria-label="Episodes">
      <div className="flex items-center justify-between gap-3 pb-2 pt-[max(5rem,env(safe-area-inset-top))]">
        <h2 className="text-[clamp(1.4rem,1.9vw,2rem)] font-black tracking-[-0.03em] text-white">Episodes</h2>
        <button type="button" onClick={onClose} className="tv-pick-close" aria-label="Close episode list">
          <X />
        </button>
      </div>
      {seasons.length > 1 ? (
        <div className="no-scrollbar mb-4 flex gap-3 overflow-x-auto pb-2 pt-3" role="group" aria-label="Seasons">
          {seasons.map(([seasonNumber, episodes]) => (
            <button
              key={seasonNumber}
              type="button"
              onClick={() => setSelectedSeason(seasonNumber)}
              aria-pressed={activeSeason === seasonNumber}
              className={`tv-season-pill${activeSeason === seasonNumber ? " is-active" : ""}`}
            >
              Season {seasonNumber}
              <span className="tv-season-count">{episodes.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      <ol className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-10 pr-1 pt-3">
        {activeEpisodes.map((episode) => {
          const isCurrent = episode.id === currentEpisodeId;
          const progress = episodeProgressPercent(episode);
          return (
            <li key={episode.id}>
              <button
                type="button"
                onClick={() => {
                  if (isCurrent) {
                    onClose();
                    return;
                  }
                  onPick(episode);
                }}
                aria-current={isCurrent}
                className={`tv-episode-row-big tv-pick-row${isCurrent ? " is-current" : ""}`}
                aria-label={isCurrent ? `Playing ${formatEpisodeTitle(episode)}` : `Play ${formatEpisodeTitle(episode)}`}
              >
                <span className="tv-episode-code-big">{episodeCodeLabel(episode)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[clamp(1.15rem,1.6vw,1.7rem)] font-black tracking-[-0.02em] text-white">
                    {formatEpisodeTitle(episode)}
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    {isCurrent ? (
                      <span className="tv-now-badge"><Play className="fill-current" />Playing</span>
                    ) : episode.watched ? (
                      <span className="tv-watched-badge"><Check />Watched</span>
                    ) : progress > 0 ? (
                      <span className="tv-resume-label">{progress}% watched</span>
                    ) : null}
                  </span>
                </span>
                {!isCurrent ? (
                  <span className="tv-episode-play"><Play className="fill-current" /></span>
                ) : null}
                {progress > 0 && progress < 100 ? (
                  <span className="tv-episode-progress"><span style={{ width: `${progress}%` }} /></span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
