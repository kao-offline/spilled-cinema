// Search endpoint - returns empty results by default
// This is a placeholder endpoint in Vercel deployment
// Full search functionality should be implemented with actual API calls if needed
export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Return empty results - search can be disabled on Vercel for now
  res.status(200).json({ results: [] });
}
