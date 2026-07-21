import type { ImportedShow } from "../lib/types";
import { balancedBackgroundImage } from "../lib/image-resolution";
import { getShowArtwork, getShowMetadata } from "../lib/media-library";

type ShowCardProps = {
  show: ImportedShow;
  onOpen: (slug: string) => void;
};

export function ShowCard({ show, onOpen }: ShowCardProps) {
  const artwork = getShowArtwork(show);
  const metadata = getShowMetadata(show);
  const preview = artwork.posterUrl ?? null;
  const isMovie = metadata?.mediaType === "movie" || show.episodes.length === 1;

  return (
    <button
      onClick={() => onOpen(show.slug)}
      className="group relative flex w-full flex-col text-left transition duration-300 hover:-translate-y-1"
    >
      <div className="relative mb-2 aspect-[2/3] w-full overflow-hidden rounded-[14px] border border-white/[0.07] bg-[#111216] shadow-[0_18px_45px_rgba(0,0,0,0.32)] transition group-hover:border-white/16 group-hover:shadow-[0_24px_60px_rgba(0,0,0,0.46)] sm:mb-3.5 sm:rounded-[1.15rem]">
        {preview ? (
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
            style={balancedBackgroundImage(preview, "poster-card")}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-white/20 text-xs uppercase tracking-widest font-semibold">No Image</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/18 via-transparent to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-30" />
      </div>

      <div className="px-1">
        <h3 className="line-clamp-1 text-[12px] font-black tracking-tight text-white/90 sm:text-[15px] sm:font-semibold">
          {show.title}
        </h3>
        <p className="mt-1 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[9px] font-medium text-white/40 sm:gap-2 sm:text-[12px]">
          <span>{metadata?.years || show.years || "Unknown year"}</span>
          {!isMovie ? <span className="h-1 w-1 rounded-full bg-white/20" /> : null}
          {!isMovie ? <span className="truncate">{metadata?.seasonCount ?? show.availableSeasons.length} Seasons</span> : null}
        </p>
      </div>
    </button>
  );
}
