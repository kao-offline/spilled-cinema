import type { ArtworkSourceSettings } from "../../src/lib/types.js";
import {
  composeHomepageBanner,
  enrichArtwork,
  fetchTmdbCast,
  fetchTmdbPersonCredits,
  fetchTmdbSeasonEpisodePreviews,
  fetchTmdbTitleMetadata,
  searchArtworkAssets,
  type ArtworkApiKeys,
  type ArtworkExternalIds,
} from "../../src/server/artwork.js";
import { resolveArtworkApiKeys } from "../../src/server/shared-artwork-api-keys.js";

type RequestBody = {
  mediaType?: unknown;
  title?: unknown;
  altTitle?: unknown;
  yearHint?: unknown;
  description?: unknown;
  posterUrl?: unknown;
  backdropUrl?: unknown;
  bannerUrl?: unknown;
  bannerWithLogoUrl?: unknown;
  clearLogoUrl?: unknown;
  logoUrl?: unknown;
  externalIds?: unknown;
  artworkSources?: unknown;
  artworkApiKeys?: unknown;
  seasonNumber?: unknown;
  episodeNumber?: unknown;
  name?: unknown;
};

function getStringParam(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function readRequestBody(req: { body?: unknown }): RequestBody {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as RequestBody;
    } catch {
      return {};
    }
  }
  return req.body as RequestBody;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type HandlerResponse = {
  status: (code: number) => { json: (value: unknown) => void };
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: { method?: string; query?: Record<string, unknown>; body?: unknown }, res: HandlerResponse) {
  if (req.method === "OPTIONS") {
    res.status(204).json({});
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const action = getStringParam(req.query?.action);
  const body = readRequestBody(req);
  const apiKeys = await resolveArtworkApiKeys((body.artworkApiKeys as ArtworkApiKeys | undefined) ?? undefined);

  try {
    switch (action) {
      case "cast": {
        res.setHeader("Cache-Control", "no-store");
        const title = typeof body.title === "string" ? body.title : "";
        if (!title.trim()) {
          res.status(400).json({ error: "Title is required." });
          return;
        }
        const actors = await fetchTmdbCast({
          mediaType: body.mediaType === "movie" ? "movie" : "tv",
          title,
          altTitle: typeof body.altTitle === "string" ? body.altTitle : null,
          yearHint: typeof body.yearHint === "string" ? body.yearHint : undefined,
          description: typeof body.description === "string" ? body.description : null,
          externalIds: typeof body.externalIds === "object" && body.externalIds ? body.externalIds as ArtworkExternalIds : undefined,
          apiKeys,
        });
        res.status(200).json({ actors });
        return;
      }

      case "episode-previews": {
        res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const seasonNumber = typeof body.seasonNumber === "number" ? body.seasonNumber : Number(body.seasonNumber);
        if (!title || !Number.isFinite(seasonNumber) || seasonNumber < 1) {
          res.status(400).json({ error: "A title and valid season are required." });
          return;
        }
        const episodes = await fetchTmdbSeasonEpisodePreviews({
          title,
          altTitle: typeof body.altTitle === "string" ? body.altTitle : null,
          yearHint: typeof body.yearHint === "string" ? body.yearHint : undefined,
          description: typeof body.description === "string" ? body.description : null,
          externalIds: body.externalIds && typeof body.externalIds === "object" ? body.externalIds as ArtworkExternalIds : undefined,
          seasonNumber,
          apiKeys,
        });
        res.status(200).json({ episodes });
        return;
      }

      case "homepage-banner": {
        res.setHeader("Cache-Control", "no-store");
        if (typeof body.backdropUrl !== "string" || typeof body.title !== "string" || !body.title.trim()) {
          res.status(400).json({ error: "backdropUrl and title are required." });
          return;
        }
        const bannerUrl = await composeHomepageBanner({
          backdropUrl: body.backdropUrl,
          logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
          title: body.title,
        });
        res.status(200).json({ bannerUrl });
        return;
      }

      case "person-credits": {
        res.setHeader("Cache-Control", "no-store");
        const name = typeof body.name === "string" ? body.name : "";
        if (!name.trim()) {
          res.status(400).json({ error: "Name is required." });
          return;
        }
        const credits = await fetchTmdbPersonCredits({ name, apiKeys });
        res.status(200).json({ credits });
        return;
      }

      case "refresh": {
        res.setHeader("Cache-Control", "no-store");
        const artwork = await enrichArtwork({
          mediaType: body.mediaType === "movie" ? "movie" : "tv",
          title: typeof body.title === "string" ? body.title : "",
          altTitle: typeof body.altTitle === "string" ? body.altTitle : null,
          yearHint: typeof body.yearHint === "string" ? body.yearHint : undefined,
          description: typeof body.description === "string" ? body.description : null,
          currentPosterUrl: typeof body.posterUrl === "string" ? body.posterUrl : null,
          currentBackdropUrl: typeof body.backdropUrl === "string" ? body.backdropUrl : null,
          currentBannerUrl: typeof body.bannerUrl === "string" ? body.bannerUrl : null,
          currentBannerWithLogoUrl: typeof body.bannerWithLogoUrl === "string" ? body.bannerWithLogoUrl : null,
          currentClearLogoUrl: typeof body.clearLogoUrl === "string" ? body.clearLogoUrl : null,
          externalIds: typeof body.externalIds === "object" && body.externalIds ? body.externalIds as ArtworkExternalIds : undefined,
          sources: (body.artworkSources as ArtworkSourceSettings | undefined) ?? undefined,
          apiKeys,
        });
        res.status(200).json({ artwork });
        return;
      }

      case "search": {
        res.setHeader("Cache-Control", "no-store");
        const assets = await searchArtworkAssets({
          mediaType: body.mediaType === "movie" ? "movie" : "tv",
          title: typeof body.title === "string" ? body.title : "",
          altTitle: typeof body.altTitle === "string" ? body.altTitle : null,
          yearHint: typeof body.yearHint === "string" ? body.yearHint : undefined,
          description: typeof body.description === "string" ? body.description : null,
          currentPosterUrl: typeof body.posterUrl === "string" ? body.posterUrl : null,
          currentBackdropUrl: typeof body.backdropUrl === "string" ? body.backdropUrl : null,
          currentBannerUrl: typeof body.bannerUrl === "string" ? body.bannerUrl : null,
          currentBannerWithLogoUrl: typeof body.bannerWithLogoUrl === "string" ? body.bannerWithLogoUrl : null,
          currentClearLogoUrl: typeof body.clearLogoUrl === "string" ? body.clearLogoUrl : null,
          externalIds: typeof body.externalIds === "object" && body.externalIds ? body.externalIds as ArtworkExternalIds : undefined,
          sources: (body.artworkSources as ArtworkSourceSettings | undefined) ?? undefined,
          apiKeys,
        });
        res.status(200).json({ assets });
        return;
      }

      case "title-metadata": {
        res.setHeader("Cache-Control", "no-store");
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) {
          res.status(400).json({ error: "Title is required." });
          return;
        }
        const metadata = await fetchTmdbTitleMetadata({
          mediaType: body.mediaType === "movie" ? "movie" : "tv",
          title,
          altTitle: typeof body.altTitle === "string" ? body.altTitle : null,
          yearHint: typeof body.yearHint === "string" ? body.yearHint : undefined,
          description: typeof body.description === "string" ? body.description : null,
          externalIds: typeof body.externalIds === "object" && body.externalIds ? body.externalIds as ArtworkExternalIds : undefined,
          seasonNumber: optionalNumber(body.seasonNumber),
          episodeNumber: optionalNumber(body.episodeNumber),
          apiKeys,
        });
        res.status(200).json({ metadata });
        return;
      }

      default:
        res.status(404).json({ error: "Unknown artwork endpoint." });
        return;
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to process artwork request." });
  }
}
