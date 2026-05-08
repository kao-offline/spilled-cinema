import { Film } from "lucide-react";
import { clsx } from "clsx";
import type { ExploreItem } from "../lib/types";

type DiscoveryItemCardProps = {
  item: ExploreItem;
  onClick: (item: ExploreItem) => void;
  className?: string;
};

export function DiscoveryItemCard({ item, onClick, className }: DiscoveryItemCardProps) {
  const artwork = item.posterUrl ?? item.backdropUrl ?? null;

  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      title={item.title}
      className={clsx(
        "group relative block w-[150px] shrink-0 snap-start overflow-hidden rounded-[22px] border border-white/8 bg-[#12151c] text-left shadow-[0_18px_40px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:border-white/18 focus:outline-none focus:ring-2 focus:ring-white/20 sm:w-[165px]",
        className,
      )}
    >
      <div className="relative aspect-[0.68] overflow-hidden">
        {artwork ? (
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.04]"
            style={{ backgroundImage: `url(${artwork})` }}
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#232834,#12151c)]" />
        )}

        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,12,0.04),rgba(7,9,12,0.22)_45%,rgba(7,9,12,0.7)_76%,rgba(7,9,12,0.92)_100%)]" />

        {!artwork ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/20">
            <Film className="h-9 w-9" />
          </div>
        ) : null}

        <div className="absolute left-3 top-3 rounded-full border border-white/12 bg-black/40 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/78 backdrop-blur">
          {item.provider === "svetserialu" ? "SvetSerialu" : "Bombuj"}
        </div>

        {item.inVault ? (
          <div className="absolute right-3 top-3 rounded-full border border-emerald-400/18 bg-emerald-400/12 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-200 backdrop-blur">
            Vault
          </div>
        ) : null}

        <div className="absolute inset-x-3 bottom-3">
          <div className="line-clamp-2 text-[1rem] font-semibold leading-[1.05] tracking-[-0.025em] text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.5)]">
            {item.title}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/58">
            {item.yearLabel ?? (item.mediaType === "movie" ? "Movie" : "Series")}
          </div>
        </div>
      </div>
    </button>
  );
}
