import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandSearchResult, RemoteCommandResult } from "../lib/command-search";
import {
  buildLocalCommandResults,
  buildPersonCommandResults,
  buildRemoteCommandResults,
} from "../lib/command-search";
import { fetchExplorePeopleSuggestions, fetchTrendingFeed } from "../lib/discovery-client";
import { checkVidkingAvailability, HOMEPAGE_ARTWORK_VERSION } from "../lib/import-client";
import { buildHomepageRails, type HomepageRailItem } from "../lib/homepage-rails";
import type { ExploreItem, ImportedShow, LibraryState, UserTasteProfile } from "../lib/types";
import type { PrivateNodeConnection } from "../lib/private-node-client";
import type { IntegrationId } from "../lib/integrations";
import { CommandMenu } from "./CommandMenu";
import { readHomepageTab, writeHomepageTab, type HomepageTab } from "../lib/provider-home-preferences";
import { findImportedShowBySource, importSourceKey, selectPrimaryImportSource } from "../lib/import-guard";
import { HomeHero } from "./HomeHero";
import { HomeRail } from "./HomeRail";
import { HomeTopChrome } from "./HomeTopChrome";
import { MobileHomePage } from "./MobileHomePage";
import { ProviderHomeSurface } from "./ProviderHomeSurface";
import type { ImportActivity } from "./ImportActivityPopup";
import { buildContinueWatchingItems, buildNewEpisodeItems } from "../lib/home-personalization";
import { HomePersonalizedRail } from "./HomePersonalizedRail";
import { HomeAccountSheet } from "./HomeAccountSheet";

type CinematicHomePageProps = {
  state: LibraryState;
  featuredShow: ImportedShow | null;
  downloadedCountByShow: Record<string, number>;
  tasteProfile: UserTasteProfile;
  searchRemotes: (query: string) => Promise<RemoteCommandResult[]>;
  onOpenLibrary: () => void;
  onOpenFavorites: () => void;
  onOpenExplore: () => void;
  onOpenSettings: () => void;
  privateNodeConnection: PrivateNodeConnection;
  onOpenShow: (slug: string) => void;
  onPlayShow: (show: ImportedShow) => void;
  onPlayEpisode: (episode: ImportedShow["episodes"][number]) => void;
  onCheckNewEpisodes: () => void;
  newEpisodeCheckState: { checking: boolean; message: string | null; error: boolean };
  onImportRemote: (platform: IntegrationId, slug: string, mediaType?: "movie" | "serial", context?: { title?: string; posterUrl?: string | null }) => Promise<unknown>;
  onEnsureHomepageTextArtwork: (slug: string) => void;
  importActivity?: ImportActivity | null;
};

function normalizeRemoteResult(raw: RemoteCommandResult & {
  provider?: IntegrationId;
  importSlug?: string;
  yearLabel?: string | null;
}): RemoteCommandResult | null {
  const platform = raw.platform ?? raw.provider;
  const slug = raw.slug ?? raw.importSlug;
  if (!platform || !slug || !raw.title) {
    return null;
  }

  return {
    ...raw,
    platform,
    slug,
    year: raw.year ?? raw.yearLabel ?? null,
    detailUrl: raw.detailUrl ?? null,
    availability: raw.availability,
    availabilityReason: raw.availabilityReason ?? null,
  };
}

function preconnectVidking() {
  if (typeof document === "undefined") {
    return;
  }
  if (document.querySelector('link[data-spilled-preconnect="vidking"]')) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = "https://www.vidking.net";
  link.dataset.spilledPreconnect = "vidking";
  document.head.appendChild(link);
}

export function CinematicHomePage({
  state,
  featuredShow,
  downloadedCountByShow,
  tasteProfile,
  searchRemotes,
  onOpenLibrary,
  onOpenFavorites,
  onOpenExplore,
  onOpenSettings,
  privateNodeConnection,
  onOpenShow,
  onPlayShow,
  onPlayEpisode,
  onCheckNewEpisodes,
  newEpisodeCheckState,
  onImportRemote,
  onEnsureHomepageTextArtwork,
  importActivity,
}: CinematicHomePageProps) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileSearchActive, setMobileSearchActive] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<RemoteCommandResult[]>([]);
  const [peopleResults, setPeopleResults] = useState<CommandSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [busyResultId, setBusyResultId] = useState<string | null>(null);
  const [trendingItems, setTrendingItems] = useState<ExploreItem[]>([]);
  const [homeTab, setHomeTab] = useState<HomepageTab>(() => readHomepageTab());
  const [accountOpen, setAccountOpen] = useState(false);
  const requestedArtworkSlugs = useRef(new Set<string>());
  const availabilityRequestKey = useRef<string>("");

  useEffect(() => {
    writeHomepageTab(homeTab);
  }, [homeTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let canceled = false;
    void fetchTrendingFeed({
      mediaType: "all",
      limit: 24,
      librarySnapshot: state,
      tasteProfile,
    })
      .then((feed) => {
        if (!canceled) setTrendingItems(feed.items);
      })
      .catch(() => {
        if (!canceled) setTrendingItems([]);
      });
    return () => {
      canceled = true;
    };
  }, [state, tasteProfile]);

  useEffect(() => {
    const query = commandQuery.trim();
    if ((!commandOpen && !mobileSearchActive) || query.length < 2) {
      setRemoteResults([]);
      setPeopleResults([]);
      setSearchLoading(false);
      return;
    }

    let canceled = false;
    setSearchLoading(true);

    const load = () => {
      // Titles and people are independent result lanes. Render the primary title
      // results as soon as they arrive instead of waiting for the slower lane.
      void searchRemotes(query)
        .then((remote) => {
          if (canceled) return;
          setRemoteResults(remote.map(normalizeRemoteResult).filter((result): result is RemoteCommandResult => Boolean(result)));
        })
        .catch(() => {
          if (!canceled) setRemoteResults([]);
        })
        .finally(() => {
          if (!canceled) setSearchLoading(false);
        });

      void fetchExplorePeopleSuggestions({ query, role: "any", limit: 6 })
        .then((people) => {
          if (!canceled) setPeopleResults(buildPersonCommandResults(people));
        })
        .catch(() => {
          if (!canceled) setPeopleResults([]);
        });
    };

    const timer = window.setTimeout(() => {
      load();
    }, 180);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [commandOpen, commandQuery, mobileSearchActive, searchRemotes]);

  useEffect(() => {
    if (!commandOpen && !mobileSearchActive) {
      availabilityRequestKey.current = "";
      return;
    }

    const vidkingItems = remoteResults
      .filter((result) => result.platform === "vidking" && result.availability === "checking")
      .map((result) => ({
        importSlug: result.slug,
        mediaType: result.mediaType,
      }));
    if (vidkingItems.length === 0) {
      return;
    }

    const requestKey = vidkingItems.map((item) => `${item.mediaType ?? "unknown"}:${item.importSlug}`).sort().join("|");
    if (availabilityRequestKey.current === requestKey) {
      return;
    }
    availabilityRequestKey.current = requestKey;

    let canceled = false;
    void checkVidkingAvailability(vidkingItems).then((results) => {
      if (canceled || results.length === 0) {
        return;
      }

      if (results.some((result) => result.availability === "available")) {
        preconnectVidking();
      }

      const bySlug = new Map(results.map((result) => [result.importSlug, result]));
      setRemoteResults((current) =>
        current.map((result) => {
          if (result.platform !== "vidking") {
            return result;
          }
          const availability = bySlug.get(result.slug);
          if (!availability) {
            return result;
          }
          return {
            ...result,
            availability: availability.availability,
            availabilityReason: availability.reason ?? null,
            detailUrl: availability.detailUrl || result.detailUrl,
          };
        }),
      );
    }).catch(() => {
      // Availability is a secondary signal; search results remain visible.
    });

    return () => {
      canceled = true;
    };
  }, [commandOpen, mobileSearchActive, remoteResults]);

  const commandResults = useMemo(() => {
    const local = buildLocalCommandResults({
      query: commandQuery,
      shows: state.shows,
      downloadedCountByShow,
    });
    const remote = buildRemoteCommandResults({
      query: commandQuery,
      results: remoteResults,
      shows: state.shows,
      downloadedCountByShow,
    });
    const visibleLocalSlugs = new Set(
      local
        .filter((result) => result.kind === "local-title")
        .map((result) => result.showSlug),
    );
    const uniqueRemote = remote.filter(
      (result) => result.kind !== "remote-title" || !result.savedShowSlug || !visibleLocalSlugs.has(result.savedShowSlug),
    );
    return [...local, ...uniqueRemote, ...peopleResults];
  }, [commandQuery, downloadedCountByShow, peopleResults, remoteResults, state.shows]);

  const baseRails = useMemo(
    () => buildHomepageRails({ shows: state.shows, downloadedCountByShow, trendingItems }),
    [downloadedCountByShow, state.shows, trendingItems],
  );
  const rails = useMemo(() => baseRails.map((rail) => ({
    ...rail,
    items: rail.items.map((item) => {
      if (item.kind !== "remote" || !importActivity || importActivity.key !== importSourceKey(item.provider as IntegrationId, item.importSlug)) return item;
      return { ...item, importStatus: importActivity.status };
    }),
  })), [baseRails, importActivity]);
  const newEpisodeItems = useMemo(() => buildNewEpisodeItems(state.shows), [state.shows]);
  const continueWatchingItems = useMemo(() => buildContinueWatchingItems(state.shows), [state.shows]);

  useEffect(() => {
    const missingArtworkSlugs = rails
      .flatMap((rail) => rail.items)
      .filter(
        (item): item is Extract<HomepageRailItem, { kind: "local" }> =>
          item.kind === "local" && item.homepageArtworkVersion !== HOMEPAGE_ARTWORK_VERSION,
      )
      .map((item) => item.showSlug);

    for (const slug of Array.from(new Set(missingArtworkSlugs)).slice(0, 10)) {
      if (requestedArtworkSlugs.current.has(slug)) {
        continue;
      }
      requestedArtworkSlugs.current.add(slug);
      onEnsureHomepageTextArtwork(slug);
    }
  }, [onEnsureHomepageTextArtwork, rails]);

  const openSearch = () => setCommandOpen(true);
  const latestFeaturedEpisode = featuredShow?.episodes[featuredShow.episodes.length - 1] ?? null;

  const handlePlayResult = (result: CommandSearchResult) => {
    if (result.kind === "local-title") {
      const show = state.shows.find((entry) => entry.slug === result.showSlug);
      if (show) onPlayShow(show);
      return;
    }

    if (result.kind === "remote-title" && result.savedShowSlug) {
      const show = state.shows.find((entry) => entry.slug === result.savedShowSlug);
      if (show) onPlayShow(show);
    }
  };

  const handleMoreResult = (result: CommandSearchResult) => {
    if (result.kind === "person") {
      setCommandQuery(result.name);
      return;
    }

    if (result.kind === "local-title") {
      setCommandOpen(false);
      onOpenShow(result.showSlug);
      return;
    }

    if (result.savedShowSlug) {
      setCommandOpen(false);
      onOpenShow(result.savedShowSlug);
      return;
    }

    if (result.detailUrl) {
      window.open(result.detailUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleAddResult = async (result: CommandSearchResult) => {
    if (result.kind !== "remote-title" || result.saved) return;
    setBusyResultId(result.id);
    try {
      const source = selectPrimaryImportSource(result.sourceMatches, result);
      if (source) await onImportRemote(source.provider, source.importSlug, source.mediaType, { title: result.title, posterUrl: result.posterUrl });
    } finally {
      setBusyResultId(null);
    }
  };

  const handleOpenRailLocal = (item: HomepageRailItem) => {
    if (item.kind === "local") {
      onOpenShow(item.showSlug);
    }
  };

  const handleImportRailRemote = async (item: HomepageRailItem) => {
    if (item.kind !== "remote") return;
    const existing = findImportedShowBySource(state.shows, item.provider as IntegrationId, item.importSlug);
    if (existing) {
      onOpenShow(existing.slug);
      return;
    }
    await onImportRemote(item.provider as IntegrationId, item.importSlug, item.mediaType, { title: item.title, posterUrl: item.posterUrl });
  };

  const handleImportFromEmpty = () => {
    onOpenLibrary();
  };

  const providerSurface = homeTab === "home" ? null : (
    <ProviderHomeSurface
      key={homeTab}
      provider={homeTab}
      importActivity={importActivity}
      isInVault={(item) => Boolean(findImportedShowBySource(state.shows, item.provider, item.importSlug))}
      onImport={(item) => { void onImportRemote(item.provider, item.importSlug, item.mediaType, { title: item.title, posterUrl: item.posterUrl }); }}
      onOpenVault={(item) => {
        const show = findImportedShowBySource(state.shows, item.provider, item.importSlug);
        if (show) onOpenShow(show.slug);
      }}
    />
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05060a] text-white selection:bg-white/20 selection:text-white">
      <MobileHomePage
        featuredShow={featuredShow}
        rails={rails}
        searchQuery={commandQuery}
        searchResults={commandResults}
        searchLoading={searchLoading}
        busyResultId={busyResultId}
        onSearchQueryChange={setCommandQuery}
        onSearchActiveChange={setMobileSearchActive}
        onPlayResult={handlePlayResult}
        onAddResult={(result) => { void handleAddResult(result); }}
        onMoreResult={handleMoreResult}
        onOpenLibrary={onOpenLibrary}
        onOpenFavorites={onOpenFavorites}
        onOpenExplore={onOpenExplore}
        onOpenSettings={onOpenSettings}
        onOpenAccount={() => setAccountOpen(true)}
        accountLabel={privateNodeConnection.profileName ?? privateNodeConnection.accountName}
        motionPaused={accountOpen || commandOpen}
        onOpenLocal={handleOpenRailLocal}
        onImportRemote={handleImportRailRemote}
        onPlayFeatured={() => {
          if (featuredShow && latestFeaturedEpisode) onPlayShow(featuredShow);
          else openSearch();
        }}
        newEpisodeItems={newEpisodeItems}
        continueWatchingItems={continueWatchingItems}
        newEpisodeCheckState={newEpisodeCheckState}
        onCheckNewEpisodes={onCheckNewEpisodes}
        onPlayEpisode={onPlayEpisode}
        activeTab={homeTab}
        onTabChange={setHomeTab}
        providerContent={providerSurface}
      />

      <div className="hidden lg:block">
        <HomeTopChrome onOpenSearch={openSearch} onOpenLibrary={onOpenLibrary} onOpenSettings={onOpenSettings} onOpenAccount={() => setAccountOpen(true)} accountLabel={privateNodeConnection.profileName ?? privateNodeConnection.accountName} activeTab={homeTab} onTabChange={setHomeTab} />

        {homeTab === "home" ? <><HomeHero
          featuredShow={featuredShow}
          downloadedCount={featuredShow ? downloadedCountByShow[featuredShow.slug] ?? 0 : 0}
          onPlay={() => {
            if (featuredShow && latestFeaturedEpisode) {
              onPlayShow(featuredShow);
            } else {
              openSearch();
            }
          }}
          onAdd={() => {
            if (featuredShow) onOpenShow(featuredShow.slug);
            else handleImportFromEmpty();
          }}
          onOpenSearch={openSearch}
        />

        <main className="relative z-10 -mt-8 pb-24">
          <HomePersonalizedRail
            kind="continue-watching"
            items={continueWatchingItems}
            onPlay={(item) => onPlayEpisode(item.episode)}
          />
          <HomePersonalizedRail
            kind="new-episodes"
            items={newEpisodeItems}
            freshness={newEpisodeCheckState}
            onRetry={onCheckNewEpisodes}
            onPlay={(item) => onPlayEpisode(item.episode)}
          />
          {rails.length > 0 ? (
            rails.map((rail) => (
              <HomeRail key={rail.id} rail={rail} onOpenLocal={handleOpenRailLocal} onImportRemote={handleImportRailRemote} />
            ))
          ) : (
            <section className="px-5 py-16 text-center sm:px-10 lg:px-16">
              <div className="mx-auto max-w-md rounded-2xl border border-white/8 bg-white/[0.035] px-6 py-10">
                <div className="text-base font-black text-white">Your homepage fills up as you add titles.</div>
                <button type="button" onClick={openSearch} className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black">
                  Search sources
                </button>
              </div>
            </section>
          )}
        </main></> : providerSurface}
      </div>

      <HomeAccountSheet open={accountOpen} connection={privateNodeConnection} onClose={() => setAccountOpen(false)} onOpenSettings={onOpenSettings} />

      <CommandMenu
        open={commandOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        results={commandResults}
        loading={searchLoading}
        busyResultId={busyResultId}
        onClose={() => setCommandOpen(false)}
        onPlay={handlePlayResult}
        onAdd={(result) => {
          void handleAddResult(result);
        }}
        onMore={handleMoreResult}
      />
    </div>
  );
}
