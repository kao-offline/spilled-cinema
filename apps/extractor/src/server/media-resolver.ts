import type { ExtractedMediaCandidate } from "@/lib/types";

export async function resolveMediaCandidate(
  candidate: ExtractedMediaCandidate,
  pageUrl: string,
): Promise<ExtractedMediaCandidate> {
  const url = candidate.url;

  // Specific handling for svetserialu.to /sources/ links
  if (url.includes("svetserialu.to/sources/")) {
    try {
      const response = await fetch(url, {
        headers: {
          Referer: pageUrl,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        return candidate;
      }

      const html = await response.text();

      // Look for iframe src
      // Pattern 1: Simple <iframe src="...">
      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch?.[1]) {
        let resolvedUrl = iframeMatch[1];
        if (resolvedUrl.startsWith("//")) {
          resolvedUrl = "https:" + resolvedUrl;
        }
        
        return {
          ...candidate,
          url: resolvedUrl,
          originHint: (candidate.originHint || "") + "->resolved",
        };
      }

      // Pattern 2: JavaScript redirect/location.href
      const jsMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
      if (jsMatch?.[1]) {
        return {
          ...candidate,
          url: jsMatch[1],
          originHint: (candidate.originHint || "") + "->js-redirect",
        };
      }

      return candidate;
    } catch (error) {
      console.error("[media-resolver] Failed to resolve svetserialu link:", error);
      return candidate;
    }
  }

  return candidate;
}
