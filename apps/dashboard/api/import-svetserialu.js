import { fetchSvetSerialuShow } from "./_lib/svetserialu.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { slug } = req.body || {};

  try {
    const show = await fetchSvetSerialuShow(slug);
    return res.status(200).json({ show });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import show from svetserialu.to.";
    console.error("[svetserialu] Import error:", message);
    console.error("[svetserialu] Stack trace:", error instanceof Error ? error.stack : "");

    const blockedByProvider = /All SvetSerialu hosts failed\..*403/i.test(message);
    if (blockedByProvider) {
      return res.status(503).json({
        error:
          "SvetSerialu is blocking requests from this hosting provider (Cloudflare 403). Run imports from local desktop/dev mode or from a non-blocked backend.",
      });
    }

    return res.status(500).json({ error: message });
  }
}
