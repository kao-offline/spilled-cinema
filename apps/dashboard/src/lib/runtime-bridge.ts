import {
  isLocalhostProbeOnCooldown,
  markLocalhostProbeAttempted,
  markLocalhostProbeFailure,
} from "./localhost-probe-cache";

export type LocalRuntimeTransport = "native" | "extension" | "direct" | "node" | "fetch-server" | "hosted" | null;

export type LocalRuntimeStatus = {
  available: boolean;
  transport: LocalRuntimeTransport;
  origin?: string;
  details?: unknown;
  error?: string;
};

export function getConnectionModeLabel(status: LocalRuntimeStatus): string {
  if (!status.available || status.transport === null) {
    return "Local runtime offline";
  }

  if (status.transport === "native" || status.transport === "direct") {
    return "Running native app";
  }

  if (status.transport === "extension") {
    return "Running through extension";
  }

  if (status.transport === "node") {
    return "Running local node server";
  }

  if (status.transport === "hosted") {
    return "Running hosted dashboard";
  }

  if (status.transport === "fetch-server") {
    return "Connected through fetch server";
  }

  return "Local runtime offline";
}

const REQUEST_TYPE = "SPILLEDCINEMA_EXTENSION_REQUEST";
const RESPONSE_TYPE = "SPILLEDCINEMA_EXTENSION_RESPONSE";

function nextRequestId() {
  return `runtime_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function canUseDirectLocalFetch() {
  // Browsers treat 127.0.0.1/localhost as potentially trustworthy, so even an
  // https dashboard may reach the user's local node directly. If no node is
  // running the connection is refused quickly and we fall through.
  return true;
}

function requestExtension(message: {
  action: "ping" | "getStatus" | "fetchLocal";
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  return new Promise<unknown>((resolve, reject) => {
    const id = nextRequestId();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Extension bridge timed out."));
    }, 2500);

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || !event.data || event.data.type !== RESPONSE_TYPE || event.data.id !== id) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

      if (!event.data.ok) {
        reject(new Error(event.data.error || "Extension bridge failed."));
        return;
      }

      resolve(event.data.payload);
    }

    window.addEventListener("message", handleMessage);
    window.postMessage({ type: REQUEST_TYPE, id, ...message }, "*");
  });
}

async function probeDirectLocalRuntime() {
  if (!canUseDirectLocalFetch()) {
    return null;
  }
  if (isLocalhostProbeOnCooldown()) {
    return null;
  }

  markLocalhostProbeAttempted();
  const origins = ["http://127.0.0.1:8787", "http://localhost:8787"];
  for (const origin of origins) {
    try {
      const response = await fetch(`${origin}/api/status`);
      if (!response.ok) {
        continue;
      }
      return {
        available: true,
        transport: "direct" as const,
        origin,
        details: await response.json(),
      };
    } catch {
      // Try the next origin.
    }
  }

  markLocalhostProbeFailure();
  return null;
}

async function probeSameOriginLocalNode() {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return null;
  }

  try {
    const response = await fetch("/api/status");
    if (!response.ok) {
      return null;
    }

    return {
      available: true,
      transport: "node" as const,
      origin: window.location.origin,
      details: await response.json(),
    };
  } catch {
    return null;
  }
}

async function probeFetchServer() {
  try {
    const response = await fetch("/api/server?path=discovery%2Fnodes&capability=fetch&limit=8");
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      candidates?: Array<{
        record?: {
          endpoints?: Array<{ protocol?: string; url?: string }>;
        };
      }>;
    };
    const endpoints = payload.candidates
      ?.flatMap((candidate) => candidate.record?.endpoints ?? [])
      .filter((entry) => entry.url && (entry.protocol === "https" || entry.url.startsWith("https://"))) ?? [];

    for (const endpoint of endpoints) {
      const origin = endpoint.url!.replace(/\/$/, "");
      try {
        const statusResponse = await fetch(buildFetchServerStatusUrl(origin), {
          headers: { "bypass-tunnel-reminder": "true" },
        });
        if (!statusResponse.ok) {
          continue;
        }

        return {
          available: true,
          transport: "fetch-server" as const,
          origin,
          details: await statusResponse.json(),
        };
      } catch {
        // Try the next discovered fetch server.
      }
    }

    return null;
  } catch {
    return null;
  }
}

function shouldProxyFetchServerOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "loca.lt" || hostname.endsWith(".loca.lt") || hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

export function buildFetchServerStatusUrl(origin: string) {
  if (!shouldProxyFetchServerOrigin(origin)) {
    return `${origin}/api/status`;
  }

  const url = new URL("/api/node-proxy", window.location.origin);
  url.searchParams.set("node", origin);
  url.searchParams.set("path", "/api/status");
  return url.toString();
}

export async function probeLocalRuntime(): Promise<LocalRuntimeStatus> {
  if (window.spilledNative?.getStatus) {
    try {
      return {
        available: true,
        transport: "native",
        origin: window.spilledNative.serverUrl,
        details: await window.spilledNative.getStatus(),
      };
    } catch (error) {
      return {
        available: false,
        transport: "native",
        origin: window.spilledNative.serverUrl,
        error: error instanceof Error ? error.message : "Native runtime failed.",
      };
    }
  }

  const sameOriginNode = await probeSameOriginLocalNode();
  if (sameOriginNode) {
    return sameOriginNode;
  }

  try {
    const payload = await requestExtension({ action: "getStatus" }) as { origin?: string; data?: unknown };
    return {
      available: true,
      transport: "extension",
      origin: payload.origin,
      details: payload.data,
    };
  } catch (error) {
    const direct = await probeDirectLocalRuntime();
    if (direct) {
      return direct;
    }

    const fetchServer = await probeFetchServer();
    if (fetchServer) {
      return fetchServer;
    }

    return {
      available: false,
      transport: null,
      error: error instanceof Error ? error.message : "No local runtime found.",
    };
  }
}
