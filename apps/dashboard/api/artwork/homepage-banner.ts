import { composeHomepageBanner } from "../../src/server/artwork.js";

type RequestBody = {
  backdropUrl?: unknown;
  logoUrl?: unknown;
  title?: unknown;
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
  if (typeof body.backdropUrl !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return res.status(400).json({ error: "backdropUrl and title are required." });
  }

  try {
    const bannerUrl = await composeHomepageBanner({
      backdropUrl: body.backdropUrl,
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      title: body.title,
    });
    return res.status(200).json({ bannerUrl });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to compose homepage banner." });
  }
}
