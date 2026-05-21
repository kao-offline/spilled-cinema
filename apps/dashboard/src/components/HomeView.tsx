import { Hero } from "./Hero";
import { ShowCard } from "./ShowCard";
import type { ImportedShow } from "../lib/types";
import type { IntegrationId } from "../lib/integrations";

type RemoteSearchResult = {
  title: string;
  slug: string;
  platform: "svetserialu" | "bombuj";
  posterUrl?: string | null;
  mediaType?: "movie" | "serial";
  year?: string | null;
};

type HomeViewProps = {
  activeView: "home" | "favorites";
  query: string;
  featuredShow: ImportedShow | null;
  heroRotationMs: number;
  heroIndexKey?: string;
  onPrevHero: () => void;
  onNextHero: () => void;
  onPlayFeatured: () => void;
  onToggleFeaturedFavorite?: () => void;
  filteredShows: ImportedShow[];
  onOpenShow: (slug: string) => void;
  remoteResults: RemoteSearchResult[];
  remoteByPlatform: Record<IntegrationId, RemoteSearchResult[]>;
  remotePlatformOrder: IntegrationId[];
  isSearchingRemote: boolean;
  importing: boolean;
  onImportRemote: (result: RemoteSearchResult) => void;
};

export function HomeView({
  activeView,
  query,
  featuredShow,
  heroRotationMs,
  heroIndexKey,
  onPrevHero,
  onNextHero,
  onPlayFeatured,
  onToggleFeaturedFavorite,
  filteredShows,
  onOpenShow,
  remoteResults,
  remoteByPlatform,
  remotePlatformOrder,
  isSearchingRemote,
  importing,
  onImportRemote,
}: HomeViewProps) {
  return (
    <>
      {!query && activeView === "home" ? (
        <Hero
          featuredShow={featuredShow}
          onPrev={onPrevHero}
          onNext={onNextHero}
          progressKey={heroIndexKey}
          progressDurationMs={heroRotationMs}
          onPlay={onPlayFeatured}
          onToggleFavorite={onToggleFeaturedFavorite}
        />
      ) : null}

      <div className="mt-4 px-4 pb-12 sm:px-6 lg:px-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-white capitalize">
            {query ? "Local Vault" : activeView === "favorites" ? "Favorites" : "All Library"}
          </h2>
        </div>

        <div
          className="animate-fade-in grid grid-cols-[repeat(auto-fill,minmax(150px,182px))] justify-start gap-5 opacity-0 sm:grid-cols-[repeat(auto-fill,minmax(168px,190px))] xl:grid-cols-[repeat(auto-fill,minmax(182px,210px))]"
          style={{ animationDelay: "0.2s" }}
        >
          {filteredShows.map((show) => (
            <ShowCard key={show.slug} show={show} onOpen={onOpenShow} />
          ))}

          {filteredShows.length === 0 && !query ? (
            <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
              <span className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/20">Vault</span>
              <span className="text-sm font-medium text-white/40">
                {activeView === "favorites" ? "You haven't liked any titles yet." : "No shows found."}
              </span>
            </div>
          ) : null}
        </div>

        {query ? (
          <div className="mt-10 animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-3 text-base font-semibold tracking-tight text-white/80">
                Web Matches
                {isSearchingRemote ? (
                  <span className="animate-pulse rounded-md bg-orange-400/10 px-2 py-1 text-[10px] font-medium text-orange-400">
                    Searching extractors...
                  </span>
                ) : null}
              </h2>
            </div>

            {remoteResults.length > 0 ? (
              <div className="space-y-6">
                {remotePlatformOrder.map((platformKey) => {
                  const list = remoteByPlatform[platformKey];
                  if (list.length === 0) return null;

                  const sectionLabel = platformKey === "svetserialu" ? "SvetSerialu" : "Bombuj";
                  return (
                    <div key={platformKey} className="rounded-2xl border border-white/5 bg-white/5 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-[0.32em] text-white/40">
                          {sectionLabel}
                        </span>
                        <span className="text-[10px] font-medium text-white/30">{list.length} results</span>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {list.map((result) => {
                          const typeLabel =
                            result.mediaType === "movie" ? "Movie" : result.mediaType === "serial" ? "Serial" : "Title";

                          return (
                            <div
                              key={`${result.platform}-${result.slug}`}
                              className="group relative w-40 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#14151b] shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
                            >
                              <div
                                className="relative aspect-[2/3] w-full bg-[#0f1016] bg-cover bg-center"
                                style={result.posterUrl ? { backgroundImage: `url(${result.posterUrl})` } : undefined}
                              >
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                <div className="absolute inset-x-2 top-2 flex items-center justify-end">
                                  <span className="rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-black/85 shadow-sm">
                                    {typeLabel}
                                  </span>
                                </div>

                                <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
                                  <div className="inline-flex max-w-full rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-black shadow-lg backdrop-blur">
                                    <span className="truncate">{result.title}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.18em] text-white/85 shadow-sm">
                                      {sectionLabel}
                                    </span>
                                    <button
                                      onClick={() => onImportRemote(result)}
                                      disabled={importing}
                                      className="ml-auto rounded-full bg-white px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.2em] text-black/90 shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : !isSearchingRemote && query.length >= 3 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-8 text-center">
                <span className="text-sm font-medium text-white/40">No external titles found across active modules.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
