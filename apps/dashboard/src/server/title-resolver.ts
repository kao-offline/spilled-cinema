import type {
  ArtworkSet,
  CanonicalMetadata,
  DownloadSource,
  ExploreItem,
  ImportedShow,
  IntegrationManifestV2,
  PlayerSource,
  ProviderCandidate,
  ProviderMatch,
  ResolvedTitle,
  SubtitleSource,
  TitleIdentity,
  TitleSearchResponse,
  TitleSearchResult,
} from "../lib/types";
import { fetchIntegrationRepositoryCatalogSettled } from "../lib/provider-repositories";
import { importProviderModuleItem } from "./provider-import";
import { searchProviderModule } from "./provider-search";
import { getRemoteIntegrationAdapter } from "./remote-provider-modules";

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function identityKey(candidate: ProviderCandidate) {
  const externalId = candidate.externalIds?.imdb ?? candidate.externalIds?.tmdb ?? candidate.externalIds?.tvdb;
  if (externalId) {
    return `${candidate.mediaType}:id:${externalId}`;
  }
  const normalized = candidate.confidenceHints?.normalizedTitle ?? normalizeTitle(candidate.title);
  return `${candidate.mediaType}:title:${normalized}:${candidate.year ?? "unknown"}`;
}

function confidenceScore(candidate: ProviderCandidate, identity: TitleIdentity) {
  const externalId = candidate.externalIds?.imdb ?? candidate.externalIds?.tmdb ?? candidate.externalIds?.tvdb;
  if (externalId && Object.values(identity.externalIds).includes(externalId)) {
    return 1;
  }
  const normalized = candidate.confidenceHints?.normalizedTitle ?? normalizeTitle(candidate.title);
  if (normalized === identity.normalizedKey && candidate.year && identity.year && Math.abs(candidate.year - identity.year) <= 1) {
    return 0.92;
  }
  if (normalized === identity.normalizedKey) {
    return 0.74;
  }
  return 0.5;
}

function yearFromExploreItem(item: ExploreItem) {
  const match = item.year?.match(/\b(19|20)\d{2}\b/) ?? item.yearLabel?.match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function candidateFromExploreItem(item: ExploreItem): ProviderCandidate {
  return {
    integrationId: item.provider,
    providerItemId: item.importSlug || item.slug || item.id,
    mediaType: item.mediaType === "movie" ? "movie" : "series",
    title: item.title,
    year: yearFromExploreItem(item),
    sourceUrl: item.detailUrl,
    posterUrl: item.posterUrl,
    confidenceHints: {
      normalizedTitle: normalizeTitle(item.title),
      releaseDate: item.year ?? item.yearLabel ?? undefined,
    },
  };
}

function exploreItemFromCandidate(candidate: ProviderCandidate): ExploreItem {
  return {
    id: `${candidate.integrationId}:${candidate.providerItemId}`,
    title: candidate.title,
    slug: candidate.providerItemId,
    importSlug: candidate.providerItemId,
    provider: candidate.integrationId as ExploreItem["provider"],
    mediaType: candidate.mediaType === "movie" ? "movie" : "serial",
    detailUrl: candidate.sourceUrl ?? "",
    posterUrl: candidate.posterUrl ?? null,
    backdropUrl: null,
    year: candidate.year ? String(candidate.year) : null,
    yearLabel: candidate.year ? String(candidate.year) : null,
    description: null,
    genres: [],
    audioBuckets: [],
    languages: [],
    directors: [],
    actors: [],
    sectionKeys: [],
    inVault: false,
    availableNow: true,
  };
}

function makeIdentity(candidates: ProviderCandidate[]): TitleIdentity {
  const primary = candidates[0];
  const normalizedKey = primary.confidenceHints?.normalizedTitle ?? normalizeTitle(primary.title);
  return {
    identityId: `${primary.mediaType}:${normalizedKey}:${primary.year ?? "unknown"}`,
    mediaType: primary.mediaType,
    canonicalTitle: primary.title,
    originalTitle: primary.originalTitle,
    year: primary.year,
    externalIds: {
      imdb: candidates.find((candidate) => candidate.externalIds?.imdb)?.externalIds?.imdb,
      tmdb: candidates.find((candidate) => candidate.externalIds?.tmdb)?.externalIds?.tmdb,
      tvdb: candidates.find((candidate) => candidate.externalIds?.tvdb)?.externalIds?.tvdb,
    },
    normalizedKey,
  };
}

function makeMetadata(identity: TitleIdentity): CanonicalMetadata {
  return {
    title: identity.canonicalTitle,
    originalTitle: identity.originalTitle,
    year: identity.year,
    years: identity.year ? String(identity.year) : null,
    genres: [],
  };
}

function makeArtwork(candidates: ProviderCandidate[]): ArtworkSet {
  return {
    posterUrl: candidates.find((candidate) => candidate.posterUrl)?.posterUrl ?? null,
    backdropUrl: null,
    clearLogoUrl: null,
  };
}

function makeProviderMatches(identity: TitleIdentity, candidates: ProviderCandidate[], integrations: IntegrationManifestV2[]) {
  return candidates.map((candidate) => {
    const integration = integrations.find((entry) => entry.id === candidate.integrationId);
    return {
      identityId: identity.identityId,
      integrationId: candidate.integrationId,
      providerItemId: candidate.providerItemId,
      sourceUrl: candidate.sourceUrl,
      confidenceScore: confidenceScore(candidate, identity),
      resolvedCapabilities: integration?.capabilities ?? ["search"],
    } satisfies ProviderMatch;
  });
}

function makeResolvedTitle(candidates: ProviderCandidate[], integrations: IntegrationManifestV2[]): TitleSearchResult {
  const identity = makeIdentity(candidates);
  return {
    identity,
    metadata: makeMetadata(identity),
    artwork: makeArtwork(candidates),
    providerMatches: makeProviderMatches(identity, candidates, integrations),
    players: [],
    subtitles: [],
    downloads: [],
    resolutionStatus: {
      metadata: "partial",
      players: "pending",
    },
    candidates,
  };
}

function groupCandidates(candidates: ProviderCandidate[], integrations: IntegrationManifestV2[]) {
  const groups = new Map<string, ProviderCandidate[]>();
  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = groups.get(key);
    if (existing) {
      existing.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }
  return Array.from(groups.values()).map((group) => makeResolvedTitle(group, integrations));
}

async function searchIntegration(input: {
  integration: IntegrationManifestV2;
  query: string;
  repositoryUrls: string[];
}) {
  const adapter = await getRemoteIntegrationAdapter({
    integrationId: input.integration.id,
    repositoryUrls: input.repositoryUrls,
  });
  if (adapter?.api.search) {
    const results = await adapter.api.search({ query: input.query, limit: 20 }, adapter.context);
    return results.map((result) => {
      if ("providerItemId" in result) {
        return result as ProviderCandidate;
      }
      return candidateFromExploreItem(result as ExploreItem);
    });
  }

  const legacyResults = await searchProviderModule({
    moduleId: input.integration.id,
    query: input.query,
    repositoryUrls: input.repositoryUrls,
  });
  return legacyResults.map(candidateFromExploreItem);
}

export async function listIntegrationCatalog(input: {
  repositoryUrls: string[];
}) {
  const integrations = await fetchIntegrationRepositoryCatalogSettled(input.repositoryUrls);
  const merged = new Map<string, IntegrationManifestV2>();
  for (const integration of integrations) {
    merged.set(integration.id, integration);
  }
  return Array.from(merged.values());
}

export async function searchTitles(input: {
  query: string;
  repositoryUrls: string[];
  mediaType?: "movie" | "series";
}): Promise<TitleSearchResponse> {
  const query = input.query.trim();
  if (!query) {
    return { generatedAt: Date.now(), query, results: [] };
  }

  const integrations = (await listIntegrationCatalog({ repositoryUrls: input.repositoryUrls }))
    .filter((integration) => integration.status !== "disabled" && integration.capabilities.includes("search"));

  const settled = await Promise.allSettled(
    integrations.map((integration) => searchIntegration({
      integration,
      query,
      repositoryUrls: input.repositoryUrls,
    })),
  );
  const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((candidate) => !input.mediaType || candidate.mediaType === input.mediaType);

  return {
    generatedAt: Date.now(),
    query,
    results: groupCandidates(candidates, integrations),
  };
}

export async function resolveTitle(input: {
  title: ResolvedTitle;
  repositoryUrls: string[];
}): Promise<ResolvedTitle> {
  const integrations = await listIntegrationCatalog({ repositoryUrls: input.repositoryUrls });
  const playerResults = await Promise.allSettled(
    input.title.providerMatches.map(async (providerMatch) => {
      const adapter = await getRemoteIntegrationAdapter({
        integrationId: providerMatch.integrationId,
        repositoryUrls: input.repositoryUrls,
      });
      if (!adapter?.api.resolvePlayers) {
        return [] as PlayerSource[];
      }
      return await adapter.api.resolvePlayers({
        identity: input.title.identity,
        providerMatch,
      }, adapter.context);
    }),
  );
  const subtitleResults = await Promise.allSettled(
    input.title.providerMatches.map(async (providerMatch) => {
      const adapter = await getRemoteIntegrationAdapter({
        integrationId: providerMatch.integrationId,
        repositoryUrls: input.repositoryUrls,
      });
      if (!adapter?.api.resolveSubtitles) {
        return [] as SubtitleSource[];
      }
      return await adapter.api.resolveSubtitles({
        identity: input.title.identity,
        providerMatch,
      }, adapter.context);
    }),
  );
  const downloadResults = await Promise.allSettled(
    input.title.providerMatches.map(async (providerMatch) => {
      const adapter = await getRemoteIntegrationAdapter({
        integrationId: providerMatch.integrationId,
        repositoryUrls: input.repositoryUrls,
      });
      if (!adapter?.api.resolveDownloads) {
        return [] as DownloadSource[];
      }
      return await adapter.api.resolveDownloads({
        identity: input.title.identity,
        providerMatch,
      }, adapter.context);
    }),
  );

  const players = playerResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const subtitles = subtitleResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const downloads = downloadResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  return {
    ...input.title,
    providerMatches: input.title.providerMatches.map((match) => ({
      ...match,
      resolvedCapabilities: integrations.find((integration) => integration.id === match.integrationId)?.capabilities ?? match.resolvedCapabilities,
    })),
    players,
    subtitles,
    downloads,
    resolutionStatus: {
      metadata: input.title.resolutionStatus.metadata,
      players: players.length > 0 ? "complete" : "partial",
    },
  };
}

export async function importResolvedTitle(input: {
  title: ResolvedTitle;
  repositoryUrls: string[];
}): Promise<{ show: ImportedShow; resolvedTitle: ResolvedTitle }> {
  const resolvedTitle = await resolveTitle(input);
  const primaryMatch = resolvedTitle.providerMatches
    .find((match) => match.resolvedCapabilities.includes("import"))
    ?? resolvedTitle.providerMatches[0];
  if (!primaryMatch) {
    throw new Error("Resolved title has no provider match to import.");
  }

  const show = await importProviderModuleItem({
    moduleId: primaryMatch.integrationId,
    slug: primaryMatch.providerItemId,
    mediaType: resolvedTitle.identity.mediaType === "movie" ? "movie" : "serial",
    repositoryUrls: input.repositoryUrls,
  });
  const showWithIdentity: ImportedShow = {
    ...show,
    mediaType: resolvedTitle.identity.mediaType === "movie" ? "movie" : "serial",
    altTitle: show.altTitle ?? resolvedTitle.metadata.originalTitle ?? resolvedTitle.identity.originalTitle ?? null,
    years: show.years ?? resolvedTitle.metadata.years ?? (resolvedTitle.identity.year ? String(resolvedTitle.identity.year) : null),
    externalIds: resolvedTitle.identity.externalIds,
    posterUrl: show.posterUrl ?? resolvedTitle.artwork.posterUrl ?? null,
    backdropUrl: show.backdropUrl ?? resolvedTitle.artwork.backdropUrl ?? null,
    clearLogoUrl: show.clearLogoUrl ?? resolvedTitle.artwork.clearLogoUrl ?? null,
    canonicalIdentity: resolvedTitle.identity,
    providerMatches: resolvedTitle.providerMatches,
  };

  return {
    show: showWithIdentity,
    resolvedTitle,
  };
}

export function titleResultToExploreItem(result: TitleSearchResult): ExploreItem {
  const primary = result.candidates[0];
  return exploreItemFromCandidate(primary);
}
