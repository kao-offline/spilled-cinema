export default function handler(_req, res) {
  res.status(503).json({
    error: "Imports run through a local runtime or a discovered fetch server. This hosted endpoint does not scrape providers.",
  });
}
