function endpointName(req) {
  const value = req.query?.endpoint;
  return Array.isArray(value) ? value[0] : value;
}

export default function handler(req, res) {
  const endpoint = endpointName(req);

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
    res.status(503).json({
      error: "Imports run through a local runtime or a discovered fetch server. This hosted endpoint does not scrape providers.",
    });
    return;
  }

  res.status(404).json({ error: "Not found" });
}
