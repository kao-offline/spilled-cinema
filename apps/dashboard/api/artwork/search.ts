import type { ArtworkSourceSettings } from "../../src/lib/types.js";
import { searchArtworkAssets, type ArtworkApiKeys, type ArtworkExternalIds } from "../../src/server/artwork.js";
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
  externalIds?: unknown;
  artworkSources?: unknown;
  artworkApiKeys?: unknown;
};

function readRequestBody(req: { body?: unknown }): RequestBody {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as RequestBody;
    } catch {
      return {};
    }
  }

  return req.body as RequestBody;
}

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { status: (code: number) => { json: (value: unknown) => void }; setHeader: (name: string, value: string) => void },
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = readRequestBody(req);

  try {
    const apiKeys = await resolveArtworkApiKeys((body.artworkApiKeys as ArtworkApiKeys | undefined) ?? undefined);
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

    return res.status(200).json({ assets });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to search artwork." });
  }
}
