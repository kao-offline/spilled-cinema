import { LoaderCircle, MoreHorizontal, Search, Settings, X } from "lucide-react";
import { useState } from "react";
import type { CommandSearchResult } from "../lib/command-search";
import type { HomepageRail, HomepageRailItem } from "../lib/homepage-rails";
import type { ImportedShow } from "../lib/types";
import { balancedBackgroundImage } from "../lib/image-resolution";
import { MobileDock } from "./MobileDock";
import { CommandResultRow } from "./CommandResultRow";

type MobileHomePageProps = {
  featuredShow: ImportedShow | null;
  rails: HomepageRail[];
  searchQuery: string;
  searchResults: CommandSearchResult[];
  searchLoading: boolean;
  busyResultId: string | null;
  onSearchQueryChange: (value: string) => void;
  onSearchActiveChange: (active: boolean) => void;
  onPlayResult: (result: CommandSearchResult) => void;
  onAddResult: (result: CommandSearchResult) => void;
  onMoreResult: (result: CommandSearchResult) => void;
  onOpenLibrary: () => void;
  onOpenFavorites: () => void;
  onOpenExplore: () => void;
  onOpenSettings: () => void;
  onOpenLocal: (item: HomepageRailItem) => void;
  onImportRemote: (item: HomepageRailItem) => void;
  onPlayFeatured: () => void;
};

function getItemImage(item: HomepageRailItem, kind: "banner" | "poster") {
  if (kind === "banner") {
    return item.kind === "local"
      ? item.bannerWithLogoUrl ?? item.homepageBannerUrl ?? item.backdropUrl ?? item.bannerUrl ?? null
      : item.backdropUrl ?? item.bannerUrl ?? null;
  }

  return item.kind === "local"
    ? item.homepagePosterUrl ?? item.posterUrl ?? item.backdropUrl ?? null
    : item.posterUrl ?? item.backdropUrl ?? null;
}

export function MobileHomePage({
  featuredShow,
  rails,
  searchQuery,
  searchResults,
  searchLoading,
  busyResultId,
  onSearchQueryChange,
  onSearchActiveChange,
  onPlayResult,
  onAddResult,
  onMoreResult,
  onOpenLibrary,
  onOpenFavorites,
  onOpenExplore,
  onOpenSettings,
  onOpenLocal,
  onImportRemote,
  onPlayFeatured,
}: MobileHomePageProps) {
  const [searchActive, setSearchActive] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const bannerRails = rails.filter((rail) => rail.kind === "banner");
  const posterRails = rails.filter((rail) => rail.kind === "poster");
  const primaryBanner = bannerRails[0]?.items[0] ?? null;
  const heroImage = primaryBanner ? getItemImage(primaryBanner, "banner") : null;

  const activateItem = (item: HomepageRailItem) => {
    if (item.kind === "local") onOpenLocal(item);
    else onImportRemote(item);
  };

  return (
    <div className="mobile-home min-h-[100dvh] bg-[#090a0e] pb-32 text-white lg:hidden">
      <header className="px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onOpenLibrary} className="mx-auto block" aria-label="Open library">
          <img src="/Spilled.svg" alt="Spilled" className="h-10 w-auto brightness-0 invert" />
        </button>

        <div className="mt-5 flex gap-2.5">
          <label className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-[18px] bg-[#24262c] px-4 text-left text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] focus-within:ring-1 focus-within:ring-white/16">
            <Search className="h-5 w-5 shrink-0 text-white/48" />
            <input
              value={searchQuery}
              onFocus={() => {
                setSearchActive(true);
                onSearchActiveChange(true);
              }}
              onChange={(event) => {
                onSearchQueryChange(event.target.value);
                setExpandedResultId(null);
              }}
              placeholder="Search any movie, series or paste a link…"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/34"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  onSearchQueryChange("");
                  setExpandedResultId(null);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-white/55"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-[#24262c] text-white transition active:scale-95"
            aria-label="Open settings"
          >
            <Settings className="h-6 w-6 fill-white" />
          </button>
        </div>
      </header>

      {searchActive && searchQuery.trim().length > 0 ? (
        <section className="mx-4 mb-5 overflow-hidden rounded-[22px] border border-white/[0.07] bg-[#111319] shadow-[0_24px_60px_rgba(0,0,0,.38)]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/36">Search results</span>
            {searchLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-white/40" /> : <span className="text-[11px] font-bold text-white/28">{searchResults.length} found</span>}
          </div>
          <div className="max-h-[52dvh] overflow-y-auto p-2">
            {searchResults.length > 0 ? (
              <div className="space-y-1">
                {searchResults.map((result) => (
                  <CommandResultRow
                    key={result.id}
                    result={result}
                    expanded={expandedResultId === result.id}
                    busy={busyResultId === result.id}
                    onToggle={() => setExpandedResultId((current) => current === result.id ? null : result.id)}
                    onPlay={() => onPlayResult(result)}
                    onAdd={() => onAddResult(result)}
                    onMore={() => onMoreResult(result)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-28 items-center justify-center px-6 text-center text-sm font-semibold text-white/38">
                {searchLoading ? "Searching your vault and connected sources…" : searchQuery.trim().length < 2 ? "Type at least two characters." : "No matching titles found."}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <main className="space-y-7">
        <section className="px-4 pt-1">
          <button
            type="button"
            onClick={() => primaryBanner ? activateItem(primaryBanner) : onPlayFeatured()}
            className="group relative block aspect-[2.08/1] w-full overflow-hidden rounded-[26px] bg-[#191b20] text-left shadow-[0_18px_46px_rgba(0,0,0,0.34)]"
          >
            {heroImage ? (
              <div className="absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(heroImage, "backdrop-hero")} />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,.14),transparent_34%),linear-gradient(135deg,#252832,#111218)]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/5" />
            {!heroImage ? (
              <div className="absolute inset-x-5 bottom-5">
                <div className="text-3xl font-black tracking-[-0.04em]">{featuredShow?.title ?? "Your cinema, beautifully spilled."}</div>
              </div>
            ) : null}
          </button>
        </section>

        {posterRails.map((rail) => (
          <section key={rail.id}>
            <div className="mb-3 flex items-center justify-between px-4">
              <h2 className="text-[17px] font-black tracking-[-0.025em]">{rail.title}</h2>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/30">Swipe</span>
            </div>
            <div className="no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1">
              {rail.items.map((item) => {
                const image = getItemImage(item, "poster");
                const metadata = item.subtitle.split(/\s+\|\s+|\s{2,}/).filter(Boolean).slice(0, 2);
                return (
                  <article key={item.id} className="w-[31.5%] min-w-[108px] max-w-[164px] shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => activateItem(item)}
                      className="relative block aspect-[2/3] w-full overflow-hidden rounded-[15px] bg-[#181a20] text-left"
                    >
                      {image ? <div className="absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(image, "poster-card")} /> : null}
                      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent" />
                    </button>
                    <div className="mt-2 flex items-start gap-1">
                      <button type="button" onClick={() => activateItem(item)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[13px] font-black tracking-[-0.02em]">{item.title}</div>
                        <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[10px] font-semibold text-white/38">
                          {metadata.map((part, index) => (
                            <span key={`${item.id}:${part}`} className="flex min-w-0 items-center gap-1">
                              {index ? <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-white/28" /> : null}
                              <span className="truncate">{part}</span>
                            </span>
                          ))}
                        </div>
                      </button>
                      <button type="button" onClick={() => activateItem(item)} className="text-white/35" aria-label={`Open ${item.title}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {bannerRails.slice(1).map((rail) => (
          <section key={rail.id}>
            <h2 className="mb-3 px-4 text-[17px] font-black tracking-[-0.025em]">{rail.title}</h2>
            <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4">
              {rail.items.map((item) => {
                const image = getItemImage(item, "banner");
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => activateItem(item)}
                    className="relative aspect-[16/7] w-[82vw] max-w-[430px] shrink-0 snap-center overflow-hidden rounded-[20px] bg-[#181a20]"
                  >
                    {image ? <div className="absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(image, "backdrop-thumb")} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      <MobileDock active="home" onHome={() => undefined} onLibrary={onOpenLibrary} onFavorites={onOpenFavorites} onExplore={onOpenExplore} />
    </div>
  );
}
