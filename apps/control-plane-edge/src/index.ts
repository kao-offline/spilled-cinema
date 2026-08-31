const CONTROL_PLANE_PREFIX = "/server/";

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function proxyToControlPlane(request: Request, env: Env): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, "http://localhost");
  const headers = new Headers(request.headers);
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  headers.delete("host");
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", "https");

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });
  const response = await env.CONTROL_PLANE_SITE.fetch(upstreamRequest);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health/live") {
      return json(200, { ok: true, service: "spilled-control-plane-edge" });
    }

    if (request.method === "GET" && url.pathname === "/health/ready") {
      try {
        const probe = new Request("http://localhost/server/v2/nodes/verification-candidates", {
          method: "GET",
          headers: { "user-agent": "spilled-control-plane-edge-readiness" },
        });
        const response = await env.CONTROL_PLANE_SITE.fetch(probe);
        return json(response.status < 500 ? 200 : 503, {
          ok: response.status < 500,
          upstreamStatus: response.status,
        });
      } catch (error) {
        console.error(JSON.stringify({
          message: "control plane readiness probe failed",
          error: error instanceof Error ? error.message : String(error),
        }));
        return json(503, {
          ok: false,
          error: "Control plane is unreachable.",
        });
      }
    }

    if (!url.pathname.startsWith(CONTROL_PLANE_PREFIX)) {
      return json(404, { error: "Not found." });
    }

    try {
      return await proxyToControlPlane(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        message: "control plane proxy request failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json(503, {
        error: "Control plane is temporarily unavailable.",
      });
    }
  },
} satisfies ExportedHandler<Env>;
