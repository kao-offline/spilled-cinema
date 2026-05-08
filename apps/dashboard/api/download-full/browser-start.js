const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function base64UrlToBuffer(value) {
  const pad = "===".slice((value.length + 3) % 4);
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sanitizeFilename(value) {
  return String(value || "download")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function buildFileName(body) {
  const show = sanitizeFilename(body.showTitle || "Show");
  const season = String(Number(body.seasonNumber || 0)).padStart(2, "0");
  const episode = String(Number(body.episodeNumber || 0)).padStart(2, "0");
  const episodeTitle = sanitizeFilename(body.episodeTitle || "Episode");
  return `${show} - S${season}E${episode} - ${episodeTitle}.mp4`;
}

function splitByPlus(expression) {
  const chunks = [];
  let current = "";
  let quote = null;
  let escapeNext = false;
  let parenDepth = 0;

  for (const ch of expression) {
    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }

    if (ch === "\\") {
      current += ch;
      escapeNext = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      current += ch;
      continue;
    }

    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }

    if (ch === "+" && parenDepth === 0) {
      chunks.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function unquoteStringLiteral(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length < 2) return null;
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if (!((first === "'" && last === "'") || (first === '"' && last === '"'))) {
    return null;
  }

  const inner = trimmed.slice(1, -1);
  return inner
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function evalStringPart(part) {
  const direct = unquoteStringLiteral(part);
  if (direct !== null) return direct;

  const normalized = String(part || "").trim();
  const complexMatch = normalized.match(/^\((['"])((?:\\.|(?!\1).)*)\1\)((?:\.substring\(\d+\))+)$/);
  if (!complexMatch) return null;

  const [, quoteChar, rawInner, substringChain] = complexMatch;
  const unescaped = unquoteStringLiteral(`${quoteChar}${rawInner}${quoteChar}`);
  if (unescaped === null) return null;

  let out = unescaped;
  for (const sub of substringChain.matchAll(/\.substring\((\d+)\)/g)) {
    out = out.substring(Number(sub[1]));
  }
  return out;
}

function evaluateConcatExpression(expression) {
  const parts = splitByPlus(expression);
  if (!parts.length) return null;

  let out = "";
  for (const part of parts) {
    const evaluated = evalStringPart(part);
    if (evaluated === null) return null;
    out += evaluated;
  }
  return out;
}

function normalizeStreamtapeMediaUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed.includes("/get_video?")) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https:/${trimmed}`;
  return `https://${trimmed}`;
}

function extractSources(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (!Array.isArray(payload.sources)) return [];

  return payload.sources
    .map((entry) => (entry && (entry.url || entry.file)) || "")
    .filter((value) => typeof value === "string" && value.length > 0);
}

function decryptAesGcmPayload(ivB64u, payloadB64u, key) {
  const iv = base64UrlToBuffer(ivB64u);
  const payload = base64UrlToBuffer(payloadB64u);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);

  const decipher = require("node:crypto").createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

async function resolveStreamtapeUrl(embedUrl) {
  const response = await fetch(embedUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.bombuj.si/",
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();

  const assignmentMatch = html.match(/document\.getElementById\(['\"]robotlink['\"]\)\.innerHTML\s*=\s*([^;]+);/i);
  if (assignmentMatch && assignmentMatch[1]) {
    const evaluated = evaluateConcatExpression(assignmentMatch[1]);
    if (evaluated) {
      const normalized = normalizeStreamtapeMediaUrl(evaluated);
      if (normalized) return normalized;
    }
  }

  const robotDivMatch = html.match(/<div\s+id=["']robotlink["'][^>]*>([^<]+)<\/div>/i);
  if (robotDivMatch && robotDivMatch[1]) {
    const normalized = normalizeStreamtapeMediaUrl(robotDivMatch[1]);
    if (normalized) return normalized;
  }

  const snippetMatches = [...html.matchAll(/\/get_video\?id=[^"'\s<]+/gi)].map((m) => m[0]);
  if (snippetMatches.length > 0) {
    const counts = new Map();
    for (const snippet of snippetMatches) {
      counts.set(snippet, (counts.get(snippet) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] && [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (best) return `https://streamtape.com${best}`;
  }

  return null;
}

async function resolveF16PxStream(embedUrl) {
  let parsed;
  try {
    parsed = new URL(embedUrl);
  } catch {
    return null;
  }

  const playbackParam = parsed.searchParams.get("playback");
  if (!playbackParam) {
    return null;
  }

  let body;
  try {
    body = JSON.parse(decodeURIComponent(playbackParam));
  } catch {
    return null;
  }

  const pb = body.playback;
  if (!pb) {
    return null;
  }

  const sources = [];

  if (pb.iv && pb.payload && Array.isArray(pb.key_parts) && pb.key_parts.length > 0) {
    const key = Buffer.concat(pb.key_parts.map((value) => base64UrlToBuffer(value)));
    const decoded = decryptAesGcmPayload(pb.iv, pb.payload, key);
    sources.push(...extractSources(decoded));
  }

  if (pb.iv2 && pb.payload2 && pb.decrypt_keys && pb.decrypt_keys.edge_1 && pb.decrypt_keys.edge_2) {
    const key2 = Buffer.concat([base64UrlToBuffer(pb.decrypt_keys.edge_1), base64UrlToBuffer(pb.decrypt_keys.edge_2)]);
    const decoded2 = decryptAesGcmPayload(pb.iv2, pb.payload2, key2);
    sources.push(...extractSources(decoded2));
  }

  const unique = Array.from(new Set(sources));
  return unique.find((entry) => /\.mp4(?:$|[?#])/i.test(entry)) ?? unique.find((entry) => entry.includes(".m3u8")) ?? unique[0] ?? null;
}

async function resolveStreamUrl(embedUrl) {
  if (!embedUrl || typeof embedUrl !== "string") return null;

  if (embedUrl.includes("svetserialu.to/sources/")) {
    throw new Error("Episode using svetserialu internal endpoint. Re-import the show to refresh providers.");
  }

  if (embedUrl.includes("f16px")) {
    return resolveF16PxStream(embedUrl);
  }

  if (/streamtape\./i.test(embedUrl)) {
    return resolveStreamtapeUrl(embedUrl);
  }

  if (embedUrl.includes(".mp4") || embedUrl.includes(".m3u8")) {
    return embedUrl;
  }

  try {
    const response = await fetch(embedUrl, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
    if (mp4Match && mp4Match[0]) {
      return mp4Match[0].replace(/\\u0026/g, "&");
    }

    const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (m3u8Match && m3u8Match[0]) {
      return m3u8Match[0].replace(/\\u0026/g, "&");
    }
  } catch {
    return null;
  }

  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  try {
    const body = await readBody(req);

    const mergedCandidates = [
      { embedUrl: body.embedUrl, subtitlesUrl: body.subtitlesUrl },
      ...(Array.isArray(body.streamCandidates) ? body.streamCandidates : []),
    ];

    const dedupedCandidates = Array.from(
      new Map(
        mergedCandidates
          .filter((candidate) => typeof candidate.embedUrl === "string" && candidate.embedUrl.trim().length > 0)
          .map((candidate) => [candidate.embedUrl, candidate]),
      ).values(),
    );

    if (dedupedCandidates.length === 0) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing stream candidates." }));
      return;
    }

    let selectedCandidate = null;
    let resolvedUrl = null;
    let lastError = null;

    for (const candidate of dedupedCandidates) {
      try {
        const resolved = await resolveStreamUrl(candidate.embedUrl);
        if (resolved) {
          selectedCandidate = candidate;
          resolvedUrl = resolved;
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!resolvedUrl || !selectedCandidate) {
      res.statusCode = 422;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: lastError || "Could not resolve direct stream URL from player links." }));
      return;
    }

    const parsed = new URL(resolvedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.statusCode = 422;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Resolved stream has unsupported protocol." }));
      return;
    }

    const fileName = buildFileName(body);
    const referer = selectedCandidate.embedUrl || body.embedUrl || "";
    const downloadUrl = `/api/download-full/browser-file?url=${encodeURIComponent(resolvedUrl)}&name=${encodeURIComponent(fileName)}&referer=${encodeURIComponent(referer)}`;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        downloadUrl,
        resolvedUrl,
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to resolve browser download." }));
  }
};
