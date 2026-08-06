const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function absoluteUrl(value: string, base: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

export function shouldResolvePlayerUrl(provider: string | undefined, embedUrl: string | undefined) {
  const signature = `${provider ?? ""} ${embedUrl ?? ""}`.toLowerCase();
  return /(?:^|[^a-z])(2embed|multiembed|moviesclub|primewire)(?:[^a-z]|$)/i.test(signature);
}

function extractIframeCandidate(html: string, currentUrl: string) {
  const iframeSrc = matchOne(html, /<iframe[^>]+src=["']([^"'#?][^"']*)["']/i);
  if (!iframeSrc) {
    return null;
  }

  return absoluteUrl(iframeSrc, currentUrl);
}

function extractRedirectCandidate(html: string, currentUrl: string) {
  const candidates = [
    matchOne(html, /window\.location\.href\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /window\.location\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /top\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /parent\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i),
    matchOne(html, /location\.replace\(\s*["']([^"']+)["']\s*\)/i),
    matchOne(html, /location\.assign\(\s*["']([^"']+)["']\s*\)/i),
    matchOne(
      html,
      /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i,
    ),
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    return null;
  }

  return absoluteUrl(candidates[0], currentUrl);
}

export function chooseResolvedPlayerCandidate(
  html: string,
  currentUrl: string,
  provider: string | undefined,
) {
  const iframeCandidate = extractIframeCandidate(html, currentUrl);
  const redirectCandidate = extractRedirectCandidate(html, currentUrl);
  const signature = `${provider ?? ""} ${currentUrl}`.toLowerCase();

  if (/moviesclub/.test(signature)) {
    return iframeCandidate ?? null;
  }

  if (/primewire/.test(signature)) {
    return redirectCandidate ?? iframeCandidate ?? null;
  }

  if (/2embed|multiembed/.test(signature)) {
    return iframeCandidate ?? redirectCandidate ?? null;
  }

  return iframeCandidate ?? redirectCandidate ?? null;
}

async function fetchPlayerHtml(targetUrl: string, refererUrl?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(targetUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,cs;q=0.8",
        Referer: refererUrl ?? targetUrl,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Player page request failed: ${response.status} ${response.statusText}`);
    }

    const finalUrl = response.url || targetUrl;
    const contentType = response.headers.get("content-type") || "";

    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return {
        finalUrl,
        html: null,
      };
    }

    return {
      finalUrl,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePlayerEmbedUrl(input: {
  embedUrl: string;
  provider?: string;
}) {
  let currentUrl = input.embedUrl;
  let refererUrl: string | undefined;
  const visited = new Set<string>();

  for (let depth = 0; depth < 4; depth += 1) {
    if (visited.has(currentUrl)) {
      break;
    }
    visited.add(currentUrl);

    const { finalUrl, html } = await fetchPlayerHtml(currentUrl, refererUrl);
    currentUrl = finalUrl;

    if (!html) {
      return currentUrl;
    }

    const candidate = chooseResolvedPlayerCandidate(html, currentUrl, input.provider);
    if (!candidate || candidate === currentUrl || visited.has(candidate)) {
      return currentUrl;
    }

    refererUrl = currentUrl;
    currentUrl = candidate;
  }

  return currentUrl;
}
