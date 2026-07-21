import { fetchTmdbTitleMetadata, type ArtworkApiKeys, type ArtworkExternalIds } from "../../src/server/artwork.js";
import { resolveArtworkApiKeys } from "../../src/server/shared-artwork-api-keys.js";

type RequestBody = {
  mediaType?: unknown;
  title?: unknown;
  altTitle?: unknown;
  yearHint?: unknown;
  description?: unknown;
  externalIds?: unknown;
  seasonNumber?: unknown;
  episodeNumber?: unknown;
  artworkApiKeys?: unknown;
};

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

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { status: (code: number) => { json: (value: unknown) => void }; setHeader: (name: string, value: string) => void },
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = readRequestBody(req);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return res.status(400).json({ error: "Title is required." });

  try {
    const apiKeys = await resolveArtworkApiKeys((body.artworkApiKeys as ArtworkApiKeys | undefined) ?? undefined);
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
    return res.status(200).json({ metadata });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch title metadata." });
  }
}
