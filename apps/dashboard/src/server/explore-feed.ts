import type {
  ExploreFacet,
  ExploreFacetCounts,
  ExploreFeedResponse,
  ExploreFilters,
  ExploreItem,
  ExploreSection,
  ExploreSectionKey,
  LibraryState,
  UserTasteProfile,
} from "../lib/types";
import { buildDiscoveryScore, normalizeDiscoveryText } from "./discovery-ranking";
import { getBombujMovieSections, getBombujSeriesSections, hydrateBombujItem, searchBombujPeople } from "./bombuj-discovery";
import { getSvetSections, hydrateSvetItem } from "./svetserialu-discovery";

const DEFAULT_LIMIT = 48;

type FacetGroupKey = keyof Pick<ExploreFacetCounts, "mediaTypes" | "providers" | "genres" | "audioBuckets" | "networks" | "sections">;

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeAndMerge(items: ExploreItem[]) {
  const merged = new Map<string, ExploreItem>();

  for (const item of items) {
    const key = `${item.provider}:${item.mediaType}:${item.slug}:${item.episode?.episodeCode ?? "title"}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    merged.set(key, {
      ...existing,
      title: existing.title || item.title,
      posterUrl: existing.posterUrl ?? item.posterUrl ?? null,
      backdropUrl: existing.backdropUrl ?? item.backdropUrl ?? null,
      genres: uniqueStrings([...existing.genres, ...item.genres]),
      audioBuckets: uniqueStrings([...existing.audioBuckets, ...item.audioBuckets]) as ExploreItem["audioBuckets"],
      sectionKeys: uniqueStrings([...existing.sectionKeys, ...item.sectionKeys]) as ExploreSectionKey[],
      directors: uniqueStrings([...existing.directors, ...item.directors]),
      actors: uniqueStrings([...existing.actors, ...item.actors]),
      languages: uniqueStrings([...existing.languages, ...item.languages]),
      description: existing.description ?? item.description,
      network: existing.network ?? item.network,
      year: existing.year ?? item.year,
      yearLabel: existing.yearLabel ?? item.yearLabel,
    });
  }

  return [...merged.values()];
}

function hydrateLocalVaultMap(librarySnapshot: LibraryState) {
  const byProviderSlug = new Map<string, { importedAt: number; inVault: boolean }>();
  const byNormalizedTitle = new Map<string, { importedAt: number; inVault: boolean }>();

  for (const show of librarySnapshot.shows) {
    const providerSlug = show.slug.startsWith("bombuj-") ? `bombuj:${show.slug.replace(/^bombuj-/, "")}` : `svetserialu:${show.slug}`;
    const payload = { importedAt: show.importedAt, inVault: true };
    byProviderSlug.set(providerSlug, payload);
    byNormalizedTitle.set(normalizeDiscoveryText(show.title), payload);
    if (show.altTitle) {
      byNormalizedTitle.set(normalizeDiscoveryText(show.altTitle), payload);
    }
  }

  return { byProviderSlug, byNormalizedTitle };
}

function attachVaultState(items: ExploreItem[], librarySnapshot: LibraryState) {
  const { byProviderSlug, byNormalizedTitle } = hydrateLocalVaultMap(librarySnapshot);
  return items.map((item) => {
    const providerKey = `${item.provider}:${item.slug}`;
    const matched = byProviderSlug.get(providerKey) ?? byNormalizedTitle.get(normalizeDiscoveryText(item.title));

    return {
      ...item,
      inVault: Boolean(matched?.inVault),
      importedAt: matched?.importedAt,
    };
  });
}

function isLowQualityExploreItem(item: ExploreItem) {
  const normalizedTitle = normalizeDiscoveryText(item.title);
  const normalizedSlug = normalizeDiscoveryText(item.slug);

  if (!normalizedTitle || normalizedTitle.length < 3) {
    return true;
  }

  if (item.provider === "bombuj") {
    if (normalizedTitle.includes("online filmy a serialy bombuj")) {
      return true;
    }

    if (normalizedSlug === "online filmy a serialy") {
      return true;
    }
  }

  return false;
}

function parseItemYear(item: ExploreItem) {
  const numericYear = Number.parseInt(item.year?.match(/\b(19|20)\d{2}\b/)?.[0] ?? "", 10);
  return Number.isFinite(numericYear) ? numericYear : null;
}

export function matchesBaseFilters(item: ExploreItem, filters: ExploreFilters) {
  if (filters.inVault === "yes" && !item.inVault) {
    return false;
  }

  if (filters.inVault === "no" && item.inVault) {
    return false;
  }

  if (filters.availability === "available" && !item.availableNow) {
    return false;
  }

  if (filters.yearMin || filters.yearMax) {
    const numericYear = parseItemYear(item);
    if (numericYear === null) {
      return false;
    }
    if (filters.yearMin && numericYear < filters.yearMin) {
      return false;
    }
    if (filters.yearMax && numericYear > filters.yearMax) {
      return false;
    }
  }

  if (filters.personQuery?.trim()) {
    const personQuery = normalizeDiscoveryText(filters.personQuery);
    const personFields =
      filters.personRole === "director"
        ? item.directors
        : filters.personRole === "actor"
          ? item.actors
          : [...item.directors, ...item.actors];

    if (!personFields.some((entry) => normalizeDiscoveryText(entry).includes(personQuery))) {
      return false;
    }
  }

  return true;
}

export function matchesFacetGroupExcept(group: FacetGroupKey, item: ExploreItem, filters: ExploreFilters) {
  if (!matchesBaseFilters(item, filters)) {
    return false;
  }

  if (group !== "mediaTypes" && filters.mediaTypes.length > 0 && !filters.mediaTypes.includes(item.mediaType)) {
    return false;
  }

  if (group !== "providers" && filters.providers.length > 0 && !filters.providers.includes(item.provider)) {
    return false;
  }

  if (group !== "genres" && filters.genres.length > 0) {
    const normalizedItemGenres = item.genres.map((genre) => normalizeDiscoveryText(genre));
    const requiredGenres = filters.genres.map((genre) => normalizeDiscoveryText(genre));
    if (!requiredGenres.some((genre) => normalizedItemGenres.includes(genre))) {
      return false;
    }
  }

  if (group !== "audioBuckets" && filters.audioBuckets.length > 0 && !filters.audioBuckets.some((bucket) => item.audioBuckets.includes(bucket))) {
    return false;
  }

  if (group !== "networks" && filters.networks.length > 0) {
    const itemNetwork = normalizeDiscoveryText(item.network);
    if (!filters.networks.some((network) => normalizeDiscoveryText(network) === itemNetwork)) {
      return false;
    }
  }

  if (group !== "sections" && filters.sections.length > 0 && !filters.sections.some((section) => item.sectionKeys.includes(section))) {
    return false;
  }

  return true;
}

export function matchesFilters(item: ExploreItem, filters: ExploreFilters) {
  return (
    matchesBaseFilters(item, filters) &&
    (filters.mediaTypes.length === 0 || filters.mediaTypes.includes(item.mediaType)) &&
    (filters.providers.length === 0 || filters.providers.includes(item.provider)) &&
    (filters.genres.length === 0 ||
      filters.genres
        .map((genre) => normalizeDiscoveryText(genre))
        .some((genre) => item.genres.map((entry) => normalizeDiscoveryText(entry)).includes(genre))) &&
    (filters.audioBuckets.length === 0 || filters.audioBuckets.some((bucket) => item.audioBuckets.includes(bucket))) &&
    (filters.networks.length === 0 ||
      filters.networks.some((network) => normalizeDiscoveryText(network) === normalizeDiscoveryText(item.network))) &&
    (filters.sections.length === 0 || filters.sections.some((section) => item.sectionKeys.includes(section)))
  );
}

function buildFacet(entries: Map<string, ExploreFacet>, key: string, label: string, provider?: ExploreItem["provider"]) {
  const entryKey = `${provider ?? "all"}:${key}`;
  const current = entries.get(entryKey);
  entries.set(entryKey, {
    key,
    label,
    provider,
    count: (current?.count ?? 0) + 1,
  });
}

function addSeedFacets(target: Map<string, ExploreFacet>, seeds: ExploreFacet[] | undefined) {
  for (const seed of seeds ?? []) {
    const seedKey = `${seed.provider ?? "all"}:${seed.key}`;
    if (!target.has(seedKey)) {
      target.set(seedKey, {
        ...seed,
        count: 0,
      });
    }
  }
}

type FacetMapSet = {
  mediaTypes: Map<string, ExploreFacet>;
  providers: Map<string, ExploreFacet>;
  genres: Map<string, ExploreFacet>;
  audioBuckets: Map<string, ExploreFacet>;
  networks: Map<string, ExploreFacet>;
  sections: Map<string, ExploreFacet>;
};

function fillFacetMaps(items: ExploreItem[], target: FacetMapSet) {
  for (const item of items) {
    buildFacet(target.mediaTypes, item.mediaType, item.mediaType === "movie" ? "Movies" : "Series");
    buildFacet(target.providers, item.provider, item.provider === "svetserialu" ? "SvetSerialu" : "Bombuj");

    for (const genre of item.genres) {
      buildFacet(target.genres, normalizeDiscoveryText(genre), genre, item.provider);
    }

    for (const bucket of item.audioBuckets) {
      const label =
        bucket === "subtitles" ? "Subtitles" :
        bucket === "dubbing" ? "Dubbing" :
        bucket === "no_subtitles" ? "No subtitles" :
        "All audio";
      buildFacet(target.audioBuckets, bucket, label, item.provider);
    }

    if (item.network) {
      buildFacet(target.networks, normalizeDiscoveryText(item.network), item.network, item.provider);
    }

    for (const section of item.sectionKeys) {
      const labelMap: Record<ExploreSectionKey, string> = {
        newest: "Newest",
        popular: "Popular",
        latestEpisodes: "Latest Episodes",
        topOverall: "Top Overall",
        topToday: "Top Today",
        novinky: "Novinky",
        genreBrowse: "Genre Browse",
      };
      buildFacet(target.sections, section, labelMap[section], item.provider);
    }
  }
}

export function buildFacetCounts(items: ExploreItem[], filters: ExploreFilters, seeds?: Partial<ExploreFacetCounts>): ExploreFacetCounts {
  const createMaps = () => ({
    mediaTypes: new Map<string, ExploreFacet>(),
    providers: new Map<string, ExploreFacet>(),
    genres: new Map<string, ExploreFacet>(),
    audioBuckets: new Map<string, ExploreFacet>(),
    networks: new Map<string, ExploreFacet>(),
    sections: new Map<string, ExploreFacet>(),
  });

  const mediaMaps = createMaps();
  fillFacetMaps(items.filter((item) => matchesFacetGroupExcept("mediaTypes", item, filters)), mediaMaps);

  const providerMaps = createMaps();
  fillFacetMaps(items.filter((item) => matchesFacetGroupExcept("providers", item, filters)), providerMaps);

  const genreMaps = createMaps();
  fillFacetMaps(items.filter((item) => matchesFacetGroupExcept("genres", item, filters)), genreMaps);

  const audioMaps = createMaps();
  fillFacetMaps(items.filter((item) => matchesFacetGroupExcept("audioBuckets", item, filters)), audioMaps);

  const networkMaps = createMaps();
  fillFacetMaps(items.filter((item) => matchesFacetGroupExcept("networks", item, filters)), networkMaps);

  const sectionMaps = createMaps();
  fillFacetMaps(items.filter((item) => matchesFacetGroupExcept("sections", item, filters)), sectionMaps);

  addSeedFacets(mediaMaps.mediaTypes, seeds?.mediaTypes);
  addSeedFacets(providerMaps.providers, seeds?.providers);
  addSeedFacets(genreMaps.genres, seeds?.genres);
  addSeedFacets(audioMaps.audioBuckets, seeds?.audioBuckets);
  addSeedFacets(networkMaps.networks, seeds?.networks);
  addSeedFacets(sectionMaps.sections, seeds?.sections);

  const sortFacets = (input: Map<string, ExploreFacet>) => [...input.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return {
    mediaTypes: sortFacets(mediaMaps.mediaTypes),
    providers: sortFacets(providerMaps.providers),
    genres: sortFacets(genreMaps.genres),
    audioBuckets: sortFacets(audioMaps.audioBuckets),
    networks: sortFacets(networkMaps.networks),
    sections: sortFacets(sectionMaps.sections),
  };
}

function buildSections(items: ExploreItem[]): ExploreSection[] {
  const orderedSectionKeys: ExploreSectionKey[] = ["newest", "popular", "latestEpisodes", "topToday", "topOverall", "novinky", "genreBrowse"];
  const labelMap: Record<ExploreSectionKey, string> = {
    newest: "Newest",
    popular: "Popular",
    latestEpisodes: "Latest Episodes",
    topOverall: "Top Overall",
    topToday: "Top Today",
    novinky: "Novinky",
    genreBrowse: "Genre Browse",
  };

  return orderedSectionKeys
    .map((key) => ({
      key,
      label: labelMap[key],
      itemIds: items.filter((item) => item.sectionKeys.includes(key)).slice(0, 18).map((item) => item.id),
    }))
    .filter((section) => section.itemIds.length > 0);
}

async function hydrateItems(items: ExploreItem[]) {
  const hydrated = await Promise.all(
    items.map(async (item) => {
      if (item.provider === "bombuj") {
        const result = await hydrateBombujItem(item);
        return result.value;
      }
      const result = await hydrateSvetItem(item);
      return result.value;
    }),
  );

  return dedupeAndMerge(hydrated);
}

export async function getExploreFeed(input: {
  query: string;
  filters: ExploreFilters;
  sections?: string[];
  cursor?: string | null;
  limit?: number;
  librarySnapshot: LibraryState;
  tasteProfile?: UserTasteProfile;
}): Promise<ExploreFeedResponse> {
  const [bombMovies, bombSeries, svetSections, bombujPeople] = await Promise.all([
    getBombujMovieSections(),
    getBombujSeriesSections(),
    getSvetSections(),
    input.filters.personQuery?.trim() ? searchBombujPeople(input.filters.personQuery) : Promise.resolve([]),
  ]);

  let items = dedupeAndMerge([
    ...bombMovies.items,
    ...bombSeries.items,
    ...svetSections.items,
    ...bombujPeople,
  ]);

  items = await hydrateItems(items.slice(0, 180));
  items = attachVaultState(items, input.librarySnapshot);
  items = items.filter((item) => !isLowQualityExploreItem(item));

  const rankedItems = items
    .map((item) => {
      const score = buildDiscoveryScore({
        candidate: item,
        query: input.query,
        filters: input.filters,
        librarySnapshot: input.librarySnapshot,
        tasteProfile: input.tasteProfile,
      });

      return {
        ...item,
        matchScore: score.queryScore,
        discoveryScore: score.totalScore,
        recommendationReasons: score.reasons,
      } satisfies ExploreItem;
    })
    .filter((item) => !input.query.trim() || (item.matchScore ?? 0) > 0);

  const filteredItems = rankedItems.filter((item) => matchesFilters(item, input.filters));

  filteredItems.sort((left, right) => {
    const discoveryDiff = (right.discoveryScore ?? 0) - (left.discoveryScore ?? 0);
    if (discoveryDiff !== 0) {
      return discoveryDiff;
    }

    const matchDiff = (right.matchScore ?? 0) - (left.matchScore ?? 0);
    if (matchDiff !== 0) {
      return matchDiff;
    }

    if ((right.importedAt ?? 0) !== (left.importedAt ?? 0)) {
      return (right.importedAt ?? 0) - (left.importedAt ?? 0);
    }

    return left.title.localeCompare(right.title);
  });

  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
  const pagedItems = filteredItems.slice(offset, offset + limit);
  const continueCursor = offset + limit < filteredItems.length ? String(offset + limit) : null;

  return {
    generatedAt: Date.now(),
    items: pagedItems,
    facetCounts: buildFacetCounts(rankedItems, input.filters, {
      genres: [...(bombMovies.genreFacets ?? []), ...(bombSeries.genreFacets ?? [])],
    }),
    sections: buildSections(filteredItems),
    providerCoverage: uniqueStrings(filteredItems.map((item) => item.provider)) as ExploreFeedResponse["providerCoverage"],
    stale: bombMovies.stale || bombSeries.stale || svetSections.stale,
    continueCursor,
  };
}
