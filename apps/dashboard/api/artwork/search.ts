import type { ArtworkSourceSettings } from "../../src/lib/types";
import { searchArtworkAssets } from "../../src/server/artwork";

type RequestBody = {
  mediaType?: unknown;
  title?: unknown;
  altTitle?: unknown;
  yearHint?: unknown;
  description?: unknown;
  posterUrl?: unknown;
  backdropUrl?: unknown;
  clearLogoUrl?: unknown;
  artworkSources?: unknown;
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
    const assets = await searchArtworkAssets({
      mediaType: body.mediaType === "movie" ? "movie" : "tv",
      title: typeof body.title === "string" ? body.title : "",
      altTitle: typeof body.altTitle === "string" ? body.altTitle : null,
      yearHint: typeof body.yearHint === "string" ? body.yearHint : undefined,
      description: typeof body.description === "string" ? body.description : null,
      currentPosterUrl: typeof body.posterUrl === "string" ? body.posterUrl : null,
      currentBackdropUrl: typeof body.backdropUrl === "string" ? body.backdropUrl : null,
      currentClearLogoUrl: typeof body.clearLogoUrl === "string" ? body.clearLogoUrl : null,
      sources: (body.artworkSources as ArtworkSourceSettings | undefined) ?? undefined,
    });

    return res.status(200).json({ assets });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to search artwork." });
  }
}