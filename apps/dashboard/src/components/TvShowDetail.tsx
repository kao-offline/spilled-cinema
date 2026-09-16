import { useMemo, useState } from "react";
import { ArrowLeft, Captions, Check, Play, Volume2 } from "lucide-react";
import type { ImportedShow, LibraryEpisode } from "../lib/types";
import { formatEpisodeTitle } from "../lib/episode-title";
import { balanceImageResolution, balancedBackgroundImage } from "../lib/image-resolution";
import {
  getOverlayBannerArtwork,
  getTitleDescription,
  getTitleMetadataParts,
} from "../lib/media-library";
import { getEpisodeAudioAvailability } from "../lib/episode-audio";
import { episodeCodeLabel, episodeProgressPercent, groupEpisodesBySeason } from "../lib/tv-episodes";

type TvShowDetailProps = {
  show: ImportedShow;
  onBack: () => void;
  onPlayLatest: () => void;
  onSelectEpisode: (episode: LibraryEpisode) => void;
};

/**
 * Lean-back detail surface. Deliberately NOT the desktop detail:
 * hero + Play + one big episode list. No actors, no directors, no
 * recommendations, no artwork editing, no download bookkeeping — every
 * row is a single remote stop that just plays.
 */
export function TvShowDetail({ show, onBack, onPlayLatest, onSelectEpisode }: TvShowDetailProps) {
  const seasons = useMemo(() => groupEpisodesBySeason(show.episodes), [show.episodes]);
  const latestSeason = seasons[seasons.length - 1]?.[0] ?? null;
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const activeSeason = selectedSeason ?? latestSeason;
  const activeEpisodes = seasons.find(([season]) => season === activeSeason)?.[1] ?? [];
  const isMovie = show.episodes.length <= 1;

  const artwork = getOverlayBannerArtwork(show);
  const metadata = getTitleMetadataParts(show, { fallback: null })
    .map((part) => part.label)
    .slice(0, 4);
  const description = getTitleDescription(show, null);

  return (
    <div className="tv-detail min-h-screen overflow-x-hidden bg-[#05070b] text-white selection:bg-cyan-200/25">
      <section className="relative overflow-hidden px-[5vw] pb-12 pt-[clamp(6rem,10vh,8.5rem)]">
        <div className="absolute inset-0 scale-[1.015] bg-cover bg-center" style={balancedBackgroundImage(artwork?.bannerUrl ?? null, "backdrop-hero")} />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,11,.96)_0%,rgba(5,7,11,.72)_42%,rgba(5,7,11,.25)_75%,rgba(5,7,11,.55)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-[#05070b]" />

        <div className="tv-enter-hero relative z-10 max-w-[min(52rem,60vw)]">
          <button type="button" onClick={onBack} className="tv-back mb-7" aria-label="Back">
            <ArrowLeft />Back
          </button>
          {artwork?.logoUrl ? (
            <img
              src={balanceImageResolution(artwork.logoUrl, "logo") ?? artwork.logoUrl}
              alt={`${show.title} logo`}
              className="mb-6 max-h-[clamp(6rem,13vh,9.5rem)] max-w-[min(36rem,40vw)] object-contain object-left-bottom drop-shadow-[0_20px_55px_rgba(0,0,0,.7)]"
            />
          ) : (
            <h1 className="mb-5 text-[clamp(2.6rem,5vw,5.4rem)] font-black leading-[.92] tracking-[-.05em] text-white">{show.title}</h1>
          )}
          {metadata.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 text-[clamp(.85rem,1.05vw,1.1rem)] font-black text-white/76">
              {metadata.map((part) => (
                <span key={part} className="after:ml-3 after:text-cyan-200/50 after:content-['•'] last:after:hidden">{part}</span>
              ))}
            </div>
          ) : null}
          {description ? (
            <p className="line-clamp-3 max-w-[44rem] text-[clamp(.95rem,1.25vw,1.3rem)] font-medium leading-[1.55] text-white/68">{description}</p>
          ) : null}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button type="button" onClick={onPlayLatest} className="tv-hero-action tv-hero-primary">
              <Play className="fill-current" />Play
            </button>
          </div>
        </div>
      </section>

      {!isMovie && seasons.length > 0 ? (
        <main className="relative z-10 px-[5vw] pb-24">
          {seasons.length > 1 ? (
            <div className="tv-season-row no-scrollbar mb-6 flex gap-3 overflow-x-auto pb-2 pt-4" role="group" aria-label="Seasons">
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
          <ol className="flex flex-col gap-4">
            {activeEpisodes.map((episode) => {
              const audio = getEpisodeAudioAvailability(episode);
              const progress = episodeProgressPercent(episode);
              return (
                <li key={episode.id}>
                  <button type="button" onClick={() => onSelectEpisode(episode)} className="tv-episode-row-big group" aria-label={`Play ${formatEpisodeTitle(episode)}`}>
                    <span className="tv-episode-code-big">{episodeCodeLabel(episode)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[clamp(1.15rem,1.6vw,1.7rem)] font-black tracking-[-0.02em] text-white">
                        {formatEpisodeTitle(episode)}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        {episode.watched ? (
                          <span className="tv-watched-badge"><Check />Watched</span>
                        ) : progress > 0 ? (
                          <span className="tv-resume-label">{progress}% watched</span>
                        ) : null}
                        {audio.subtitles ? <span className="tv-lang-tag"><Captions />SUB</span> : null}
                        {audio.dubbing ? <span className="tv-lang-tag tv-lang-dub"><Volume2 />DUB</span> : null}
                      </span>
                    </span>
                    <span className="tv-episode-play"><Play className="fill-current" /></span>
                    {progress > 0 && progress < 100 ? (
                      <span className="tv-episode-progress"><span style={{ width: `${progress}%` }} /></span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </main>
      ) : null}
    </div>
  );
}
