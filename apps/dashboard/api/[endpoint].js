function getStringParam(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const endpoint = getStringParam(req.query?.endpoint);

  if (endpoint === "tmdb-to-imdb") {
    const tmdbId = getStringParam(req.query?.tmdbId);
    if (!tmdbId) {
      res.status(400).json({ error: "Missing tmdbId parameter." });
      return;
    }
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) {
      res.status(500).json({ error: "TMDB API key not configured." });
      return;
    }
    try {
      const mediaType = getStringParam(req.query?.mediaType) || "tv";
      const url = `https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(tmdbId)}?api_key=${tmdbKey}&append_to_response=external_ids`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        res.status(502).json({ error: "TMDB lookup failed." });
        return;
      }
      const data = await response.json();
      const imdbId = data?.external_ids?.imdb_id;
      if (imdbId && /^tt\d{5,10}$/i.test(imdbId)) {
        res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
        res.status(200).json({ imdbId });
      } else {
        res.status(200).json({ imdbId: null });
      }
    } catch {
      res.status(502).json({ error: "TMDB lookup failed." });
    }
    return;
  }

  if (endpoint === "tmdb-search") {
    const title = getStringParam(req.query?.title);
    const year = getStringParam(req.query?.year);
    if (!title) {
      res.status(400).json({ error: "Missing title parameter." });
      return;
    }
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) {
      res.status(500).json({ error: "TMDB API key not configured." });
      return;
    }
    try {
      const mediaType = getStringParam(req.query?.mediaType) || "tv";
      const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${tmdbKey}&query=${encodeURIComponent(title)}${year ? `&year=${encodeURIComponent(year)}` : ""}`;
      const response = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        res.status(502).json({ error: "TMDB search failed." });
        return;
      }
      const data = await response.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length === 0) {
        res.status(200).json({ tmdbId: null });
        return;
      }
      const best = results[0];
      const tmdbId = String(best?.id ?? "");
      let imdbId = null;
      if (tmdbId) {
        const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbKey}&append_to_response=external_ids`;
        const detailsResponse = await fetch(detailsUrl, { signal: AbortSignal.timeout(8000) });
        if (detailsResponse.ok) {
          const details = await detailsResponse.json();
          const rawImdb = details?.external_ids?.imdb_id;
          if (rawImdb && /^tt\d{5,10}$/i.test(rawImdb)) imdbId = rawImdb;
        }
      }
      res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
      res.status(200).json({ tmdbId: tmdbId || null, imdbId });
    } catch {
      res.status(502).json({ error: "TMDB search failed." });
    }
    return;
  }

  if (endpoint === "status") {
    res.status(200).json({ status: "ok" });
    return;
  }

  if (endpoint === "search") {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    res.status(200).json({ results: [] });
    return;
  }

  if (endpoint === "import-bombuj" || endpoint === "import-svetserialu") {
    res.status(503).json({ error: "Not available in hosted mode." });
    return;
  }

  res.status(404).json({ error: "Not found" });
}
