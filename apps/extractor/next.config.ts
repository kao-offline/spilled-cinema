import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production artifacts separate from a concurrently running dev server.
  // Sharing `.next` lets either process corrupt the other's route manifests.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  outputFileTracingRoot: process.cwd(),
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }

    return config;
  },
};

export default nextConfig;
