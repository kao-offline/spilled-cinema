import { Library, MoreHorizontal } from "lucide-react";
import type { HomepageRailItem, HomepageRailKind } from "../lib/homepage-rails";
import { balancedBackgroundImage } from "../lib/image-resolution";
import { ProviderIcon } from "./ProviderIcon";

type HomeMediaCardProps = {
  item: HomepageRailItem;
  railKind: HomepageRailKind;
  onOpen: () => void;
  onImport: () => void;
};

export function HomeMediaCard({ item, railKind, onOpen, onImport }: HomeMediaCardProps) {
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

  return (
    <div className={isBanner ? "group w-[78vw] max-w-[420px] shrink-0 text-left sm:w-[31rem]" : "group w-36 shrink-0 text-left sm:w-44"}>
      <button
        type="button"
        onClick={primaryAction}
        className={isBanner ? "relative block aspect-[16/7] w-full overflow-hidden rounded-2xl bg-white/8 text-left" : "relative block aspect-[2/3] w-full overflow-hidden rounded-xl bg-white/8 text-left"}
      >
        {imageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-105"
            style={balancedBackgroundImage(imageUrl, isBanner ? "backdrop-thumb" : "poster-card")}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {item.kind === "remote" ? <ProviderIcon provider={item.provider} /> : <Library className="h-7 w-7 text-white/25" />}
          </div>
        )}
      </button>
      {!isBanner ? (
        <div className="mt-3 flex min-w-0 items-start gap-2">
          <button type="button" onClick={primaryAction} className="min-w-0 flex-1 text-left">
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
