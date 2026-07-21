import { fetchTmdbPersonCredits, type ArtworkApiKeys } from "../../src/server/artwork.js";
import { resolveArtworkApiKeys } from "../../src/server/shared-artwork-api-keys.js";

type RequestBody = {
  name?: unknown;
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
    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) {
      return res.status(400).json({ error: "Name is required." });
    }

    const apiKeys = await resolveArtworkApiKeys((body.artworkApiKeys as ArtworkApiKeys | undefined) ?? undefined);
    const credits = await fetchTmdbPersonCredits({ name, apiKeys });

    return res.status(200).json({ credits });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch person credits." });
  }
}
