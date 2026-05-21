export default function handler(_req, res) {
  res.status(503).json({
    error: "Local runtime is required for imports. Start the node server with npm run start:server.",
  });
}
