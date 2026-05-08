import type { ImportedShow } from "../lib/types";

type ShowCardProps = {
  show: ImportedShow;
  onOpen: (slug: string) => void;
};

export function ShowCard({ show, onOpen }: ShowCardProps) {
  const preview = show.posterUrl ?? null;
  const isMovie = show.episodes.length === 1;

  return (
    <button
      onClick={() => onOpen(show.slug)}
      className="group relative flex w-full flex-col text-left transition-all duration-300 hover:scale-[1.02]"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-[#1a1b23] mb-4 shadow-lg">
        {preview ? (
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
            style={{ backgroundImage: `url(${preview})` }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-white/20 text-xs uppercase tracking-widest font-semibold">No Image</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-white/5" />
      </div>

      <div className="px-1">
        <h3 className="line-clamp-1 text-[15px] font-semibold tracking-tight text-white/90">
          {show.title}
        </h3>
        <p className="mt-1 flex items-center gap-2 text-[12px] font-medium text-white/40">
          <span>{show.years || "2024"}</span>
          {!isMovie ? <span className="h-1 w-1 rounded-full bg-white/20" /> : null}
          {!isMovie ? <span>{show.availableSeasons.length} Seasons</span> : null}
        </p>
      </div>
    </button>
  );
}
