type RuntimeApiResult<T> = {
  ok: boolean;
  status: number;
  data: T;
  origin?: string;
  transport: "native" | "extension" | "direct" | "node" | "fetch-server" | "hosted";
};

type JsonRequestInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

const LOCAL_RUNTIME_TIMEOUT_MS = 15000;
const LONG_RUNTIME_TIMEOUT_MS = 60000;

function canUseHostedSameOriginApi() {
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export function isHostedSameOriginApiPath(path: string) {
  return (
    path === "/api/artwork/search" ||
    path === "/api/artwork/refresh"
  );
}

function getRuntimeTimeoutMs(path: string) {
  if (
    path.startsWith("/api/import-") ||
    path.startsWith("/api/artwork/refresh")
  ) {
    return LONG_RUNTIME_TIMEOUT_MS;
  }

  return LOCAL_RUNTIME_TIMEOUT_MS;
}

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = LOCAL_RUNTIME_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}


async function fetchHostedSameOriginApi<T>(path: string, init: JsonRequestInit): Promise<RuntimeApiResult<T> | null> {
  if (!canUseHostedSameOriginApi() || !isHostedSameOriginApiPath(path)) {
    return null;
  }

  const response = await fetchWithTimeout(`${window.location.origin}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, getRuntimeTimeoutMs(path));

  return {
    ok: response.ok,
    status: response.status,
    data: (await readJsonSafe<T>(response)) as T,
    origin: window.location.origin,
    transport: "hosted",
  };
}

async function fetchNative<T>(path: string, init: JsonRequestInit): Promise<RuntimeApiResult<T> | null> {
  if (!window.spilledNative?.serverUrl) {
    return null;
  }

  const response = await fetchWithTimeout(`${window.spilledNative.serverUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, getRuntimeTimeoutMs(path));

  return {
    ok: response.ok,
    status: response.status,
    data: (await readJsonSafe<T>(response)) as T,
    origin: window.spilledNative.serverUrl,
    transport: "native",
  };
}

async function fetchExtension<T>(path: string, init: JsonRequestInit): Promise<RuntimeApiResult<T> | null> {
  const id = `runtime_${Math.random().toString(36).slice(2)}_${Date.now()}`;

  const payload = await new Promise<{ ok: boolean; status: number; origin?: string; data?: T }>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Extension bridge timed out."));
    }, 2500);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || !event.data || event.data.type !== "SPILLEDCINEMA_EXTENSION_RESPONSE" || event.data.id !== id) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (!event.data.ok) {
        reject(new Error(event.data.error || "Extension bridge failed."));
        return;
      }
      resolve(event.data.payload);
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        type: "SPILLEDCINEMA_EXTENSION_REQUEST",
        id,
        action: "fetchLocal",
        path,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body,
      },
      "*",
    );
  });

  return {
    ok: payload.ok,
    status: payload.status,
    data: (payload.data ?? null) as T,
    origin: payload.origin,
    transport: "extension",
  };
}

async function fetchDirect<T>(path: string, init: JsonRequestInit): Promise<RuntimeApiResult<T> | null> {
  if (!canUseDirectLocalFetch()) {
    return null;
  }

  for (const origin of ["http://127.0.0.1:8787", "http://localhost:8787"]) {
    try {
      const response = await fetchWithTimeout(`${origin}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }, getRuntimeTimeoutMs(path));

      return {
        ok: response.ok,
        status: response.status,
        data: (await readJsonSafe<T>(response)) as T,
        origin,
        transport: "direct",
      };
    } catch {
      // Try the next origin.
    }
  }

  return null;
}

function canUseDirectLocalFetch() {
  return window.location.protocol === "http:" || ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

async function fetchSameOriginLocalNode<T>(path: string, init: JsonRequestInit): Promise<RuntimeApiResult<T> | null> {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return null;
  }

  const response = await fetchWithTimeout(path, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, getRuntimeTimeoutMs(path));

  return {
    ok: response.ok,
    status: response.status,
    data: (await readJsonSafe<T>(response)) as T,
    origin: window.location.origin,
    transport: "node",
  };
}

type FetchServerCandidate = {
  record?: {
    endpoints?: Array<{
      protocol?: string;
      url?: string;
    }>;
  };
};

function canUseFetchServerEndpoint(endpoint: { protocol?: string; url?: string }) {
  if (!endpoint.url || !/^https?:\/\//i.test(endpoint.url)) {
    return false;
  }

  if (endpoint.protocol === "https" || endpoint.url.startsWith("https://")) {
    return true;
  }

  try {
    const url = new URL(endpoint.url);
    return window.location.protocol === "http:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function getFetchServerCapabilityForPath(path: string) {
  if (path.startsWith("/api/download-full/browser-start") || path.startsWith("/api/download-full/browser-file")) {
    return "download";
  }
  if (path.startsWith("/api/player/resolve")) {
    return "stream";
  }
  return "fetch";
}

function shouldProxyFetchServerOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "loca.lt" || hostname.endsWith(".loca.lt") || hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

function buildFetchServerRequestUrl(origin: string, path: string) {
  if (!shouldProxyFetchServerOrigin(origin)) {
    return `${origin}${path}`;
  }

  const url = new URL("/api/node-proxy", window.location.origin);
  url.searchParams.set("node", origin);
  url.searchParams.set("path", path);
  return url.toString();
}

async function fetchFetchServerCandidates(path: string) {
  const capability = getFetchServerCapabilityForPath(path);
  const capabilities = capability === "fetch" ? ["fetch"] : [capability, "fetch"];
  const origins: string[] = [];

  for (const candidateCapability of capabilities) {
    const response = await fetchWithTimeout(`/api/server?path=discovery%2Fnodes&capability=${encodeURIComponent(candidateCapability)}&limit=12`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      continue;
    }

    const payload = await readJsonSafe<{ candidates?: FetchServerCandidate[] }>(response);
    origins.push(...(payload?.candidates ?? [])
      .flatMap((candidate) => candidate.record?.endpoints ?? [])
      .filter(canUseFetchServerEndpoint)
      .map((endpoint) => endpoint.url!.replace(/\/$/, "")));
  }

  return Array.from(new Set(origins));
}

async function fetchViaFetchServer<T>(path: string, init: JsonRequestInit): Promise<RuntimeApiResult<T> | null> {
  let origins: string[] = [];
  let lastFailure: RuntimeApiResult<T> | null = null;
  try {
    origins = Array.from(new Set(await fetchFetchServerCandidates(path)));
  } catch {
    return null;
  }

  for (const origin of origins) {
    try {
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      const requestUrl = buildFetchServerRequestUrl(origin, path);
      const proxied = requestUrl.startsWith(`${window.location.origin}/api/node-proxy`);
      const response = await fetchWithTimeout(requestUrl, {
        method: init.method ?? "GET",
        headers: body === undefined
          ? {
              ...(init.headers ?? {}),
            }
          : {
              "Content-Type": "text/plain;charset=UTF-8",
              ...(init.headers ?? {}),
            },
        body,
      }, getRuntimeTimeoutMs(path));
      const data = (await readJsonSafe<T>(response)) as T & { downloadUrl?: string };
      if (proxied && data && typeof data.downloadUrl === "string" && data.downloadUrl.startsWith("/api/node-proxy")) {
        data.downloadUrl = `${window.location.origin}${data.downloadUrl}`;
      }

      if (!response.ok && (response.status >= 500 || response.status === 408 || response.status === 409 || response.status === 422)) {
        lastFailure = {
          ok: response.ok,
          status: response.status,
          data,
          origin,
          transport: "fetch-server",
        };
        continue;
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
        origin: proxied ? window.location.origin : origin,
        transport: "fetch-server",
      };
    } catch {
      // Try the next public fetch server.
    }
  }

  return lastFailure;
}


export function resolveRuntimeUrl(url: string, origin?: string) {
  if (!origin || !url.startsWith("/")) {
    return url;
  }
  return `${origin}${url}`;
}

export function buildRuntimeUrl(path: string) {
  if (window.spilledNative?.serverUrl) {
    return `${window.spilledNative.serverUrl}${path}`;
  }

  return `http://127.0.0.1:8787${path}`;
}

export async function requestRuntimeJson<T>(path: string, init: JsonRequestInit = {}): Promise<RuntimeApiResult<T>> {
  try {
    const native = await fetchNative<T>(path, init);
    if (native) {
      return native;
    }
  } catch {
    // Fall through to hosted/local/extension/direct/remote.
  }

  try {
    const sameOrigin = await fetchSameOriginLocalNode<T>(path, init);
    if (sameOrigin) {
      return sameOrigin;
    }
  } catch {
    // Fall through to extension/direct/remote.
  }

  try {
    const extension = await fetchExtension<T>(path, init);
    if (extension) {
      return extension;
    }
  } catch {
    // Fall through to direct/remote.
  }

  try {
    const direct = await fetchDirect<T>(path, init);
    if (direct) {
      return direct;
    }
  } catch {
    // Fall through to discovered fetch servers.
  }

  try {
    const hosted = await fetchHostedSameOriginApi<T>(path, init);
    if (hosted?.ok) {
      return hosted;
    }
  } catch {
    // Fall through to discovered fetch servers.
  }

  try {
    const fetchServer = await fetchViaFetchServer<T>(path, init);
    if (fetchServer) {
      return fetchServer;
    }
  } catch {
    // Fall through to hosted artwork APIs or the final error.
  }

  try {
    const hosted = await fetchHostedSameOriginApi<T>(path, init);
    if (hosted) {
      return hosted;
    }
  } catch {
    // Fall through to the final error.
  }

  throw new Error(`No runtime or fetch server is available for ${path}. Start a local node or wait for a public fetch server to register.`);
}
