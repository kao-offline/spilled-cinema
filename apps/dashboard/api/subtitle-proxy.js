const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function normalizeSubtitleText(body) {
  const trimmed = String(body || "").replace(/^\uFEFF/, "").trimStart();
  if (!/\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?[.,]\d{3}/.test(trimmed)) throw new Error("Subtitle source returned an empty or incompatible file.");
  if (/^WEBVTT\b/i.test(trimmed)) {
    return trimmed;
  }

  const converted = trimmed
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${converted}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  try {
    const rawUrl = req.url || "";
    const query = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);

    const target = params.get("url");
    if (!target) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing subtitle url." }));
      return;
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid subtitle url." }));
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unsupported protocol." }));
      return;
    }

    const isRetryable403 = (status) => status === 403 || status === 401;

    const headerStrategies = [
      { "user-agent": USER_AGENT, accept: "text/vtt,text/plain,application/json,*/*", referer: "https://svetserialu.to/" },
      { "user-agent": USER_AGENT, accept: "text/vtt,text/plain,*/*" },
      { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36", accept: "text/vtt,text/plain,*/*" },
      { "user-agent": USER_AGENT },
    ];

    const targetCandidates = (() => {
      try {
        const url = new URL(parsed);
        const host = url.hostname.toLowerCase();
        if (host === "svetserialu.to" || host.endsWith(".svetserialu.to")) {
          const rewritten = ["svetserialu.io", "svetserialov.to"].map((h) => {
            const copy = new URL(url.href);
            copy.hostname = h;
            return copy.toString();
          });
          return [url.toString(), ...rewritten];
        }
      } catch {
        // Not a rewritable URL; fall through.
      }
      return [parsed.toString()];
    })();

    const signal = AbortSignal.timeout(15_000);
    const fetchBody = async () => {
      let lastStatus = 0;
      for (const candidate of targetCandidates) {
        for (const headers of headerStrategies) {
          const response = await fetch(candidate, { method: "GET", headers, redirect: "follow", signal });
          lastStatus = response.status;
          if (response.ok || !isRetryable403(response.status)) {
            if (!response.ok) return { status: response.status, body: "" };
            const contentType = (response.headers.get("content-type") || "").toLowerCase();
            if (contentType.includes("application/json") || contentType.includes("text/json")) {
              const payload = await response.json().catch(() => null);
              if (Array.isArray(payload)) {
                const entry = payload.find((item) => item && item.default) ?? payload[0];
                if (entry && typeof entry.file === "string") {
                  let safeFile = null;
                  try {
                    const fileUrl = new URL(entry.file, response.url || candidate);
                    safeFile = /^https?:$/.test(fileUrl.protocol) ? fileUrl.href : null;
                  } catch {
                    safeFile = null;
                  }
                  if (safeFile) {
                    let vtt;
                    for (const vttHeaders of headerStrategies) {
                      vtt = await fetch(safeFile, { method: "GET", headers: vttHeaders, redirect: "follow", signal });
                      if (vtt.ok || !isRetryable403(vtt.status)) break;
                    }
                    return { status: vtt.ok ? vtt.status : 502, body: vtt.ok ? await vtt.text() : "" };
                  }
                }
              }
              return { status: 422, body: "" };
            }
            return { status: response.status, body: await response.text() };
          }
        }
      }
      return { status: lastStatus || 502, body: "" };
    };

    const { status, body } = await fetchBody();
    if (status !== 200) {
      res.statusCode = status || 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Failed to fetch subtitle file (${status}).` }));
      return;
    }

    const normalized = normalizeSubtitleText(body);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(normalized);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Subtitle proxy failed." }));
  }
};
