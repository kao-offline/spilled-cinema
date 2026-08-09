import { Check, Library, LoaderCircle, MoreHorizontal, TriangleAlert } from "lucide-react";
import { clsx } from "clsx";
import type { HomepageRailItem, HomepageRailKind } from "../lib/homepage-rails";
import { balanceImageResolution } from "../lib/image-resolution";
import { ProviderIcon } from "./ProviderIcon";

type HomeMediaCardProps = {
  item: HomepageRailItem;
  railKind: HomepageRailKind;
  onOpen: () => void;
  onImport: () => void;
  layout?: "rail" | "grid";
};

export function HomeMediaCard({ item, railKind, onOpen, onImport, layout = "rail" }: HomeMediaCardProps) {
  const isBanner = railKind === "banner";
  const imageUrl = isBanner
    ? item.kind === "local"
      ? item.bannerWithLogoUrl ?? item.homepageBannerUrl ?? item.backdropUrl ?? item.bannerUrl ?? null
      : item.backdropUrl ?? item.bannerUrl ?? null
    : item.kind === "local"
      ? item.homepagePosterUrl ?? item.posterUrl ?? item.backdropUrl
      : item.posterUrl ?? item.backdropUrl;
  const metadata = item.subtitle.split(/\s+\|\s+|\s{2,}/).filter(Boolean);
  const visibleMetadata = metadata.slice(0, 2);
  const primaryAction = item.kind === "local" ? onOpen : onImport;
  const importing = item.kind === "remote" && item.importStatus === "importing";
  const balancedImageUrl = balanceImageResolution(imageUrl, isBanner ? "backdrop-thumb" : "poster-card");

  return (
    <div className={layout === "grid" ? "animate-grid-scroll-reveal group min-w-0 text-left" : isBanner ? "group w-[78vw] max-w-[420px] shrink-0 text-left sm:w-[31rem]" : "group w-36 shrink-0 text-left sm:w-44"}>
      <button
        type="button"
        onClick={primaryAction}
        disabled={importing}
        className={isBanner ? "relative block aspect-[16/7] w-full overflow-hidden rounded-2xl bg-white/8 text-left" : "relative block aspect-[2/3] w-full overflow-hidden rounded-xl bg-white/8 text-left"}
      >
        {balancedImageUrl ? (
          <img
            src={balancedImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center transition duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {item.kind === "remote" ? <ProviderIcon provider={item.provider} /> : <Library className="h-7 w-7 text-white/25" />}
          </div>
        )}
        {item.kind === "remote" && (item.importStatus || item.inVault) ? (
          <span className={clsx(
            "absolute left-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-black uppercase tracking-[.12em] shadow-lg backdrop-blur-xl",
            item.importStatus === "error" ? "border-red-300/25 bg-red-950/75 text-red-100" :
              item.importStatus === "busy" ? "border-amber-200/25 bg-amber-950/75 text-amber-100" :
                item.importStatus === "importing" ? "border-white/20 bg-black/72 text-white" :
                  "border-emerald-200/25 bg-emerald-950/72 text-emerald-100",
          )}>
            {item.importStatus === "importing" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : item.importStatus === "error" ? <TriangleAlert className="h-3 w-3" /> : item.importStatus === "busy" ? <LoaderCircle className="h-3 w-3" /> : item.importStatus ? <Check className="h-3 w-3" /> : <Library className="h-3 w-3" />}
            {item.importStatus === "importing" ? "Importing" : item.importStatus === "added" ? "Added" : item.importStatus === "already" ? "In vault" : item.importStatus === "busy" ? "Busy" : item.importStatus === "error" ? "Failed" : "In vault"}
          </span>
        ) : null}
      </button>
      {!isBanner ? (
        <div className="mt-3 flex min-w-0 items-start gap-2">
          <button type="button" onClick={primaryAction} disabled={importing} className="min-w-0 flex-1 text-left disabled:cursor-wait">
            <div className="line-clamp-1 text-sm font-black tracking-normal text-white sm:text-base">{item.title}</div>
            <div className="mt-1 flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] font-semibold text-white/45 sm:text-xs">
              {visibleMetadata.map((part, index) => (
                <span key={`${item.id}:meta:${part}`} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 ? <span className="h-1 w-1 shrink-0 rounded-full bg-white/24" /> : null}
                  <span className="min-w-0 truncate">{part}</span>
                </span>
              ))}
            </div>
          </button>
          <button
            type="button"
            onClick={primaryAction}
            disabled={importing}
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/8 hover:text-white/78"
            aria-label={`Open menu for ${item.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
