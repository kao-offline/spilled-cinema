export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const key = reqUrl.searchParams.get("key") || "";
    if (!env.PROXY_KEY || key !== env.PROXY_KEY) {
      return new Response("Forbidden", { status: 403 });
    }

    const targetRaw = reqUrl.searchParams.get("url");
    if (!targetRaw) {
      return new Response("Missing url", { status: 400 });
    }

    let target;
    try {
      target = new URL(targetRaw);
    } catch {
      return new Response("Invalid url", { status: 400 });
    }

    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return new Response("Unsupported protocol", { status: 400 });
    }

    // Restrict proxy usage to expected hosts only.
    const allowedHosts = new Set([
      "svetserialov.to",
      "svetserialu.to",
      "svetserialu.io",
      "www.bombuj.si",
      "bombuj.si",
      "serialy.bombuj.si",
    ]);

    const host = target.hostname.toLowerCase();
    if (!allowedHosts.has(host)) {
      return new Response("Host not allowed", { status: 403 });
    }

    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
        Referer: `${target.origin}/`,
      },
      redirect: "follow",
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
