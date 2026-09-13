type Env = {
  UPSTREAM_BASE: string;
};

const UNAVAILABLE = JSON.stringify({ error: "Control plane is temporarily unavailable." });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Only proxy the control-plane API namespace to the fixed upstream.
    // Anything else is rejected so this worker can never become an open proxy.
    if (!url.pathname.startsWith("/server/")) {
      return new Response(JSON.stringify({ error: "Not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const target = `${env.UPSTREAM_BASE.replace(/\/$/, "")}${url.pathname}${url.search}`;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("cf-warp-tag");
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: "control plane proxy request failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return new Response(UNAVAILABLE, {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
