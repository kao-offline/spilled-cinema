import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export type PrivateNodeAccount = {
  accountId: string;
  watcherId?: string;
  displayName: string;
  role: "admin" | "user";
  quotaBytes: number;
  hasPassword?: boolean;
  passkeyCount?: number;
  profiles: Array<{
    profileId: string;
    displayName: string;
    avatar?: string;
  }>;
};

export type PrivateNodeConnection = {
  nodeUrl: string;
  token: string | null;
  accountId: string | null;
  profileId: string | null;
  accountName: string | null;
  profileName: string | null;
};

export type AdminNodeConnection = {
  nodeUrl: string;
  token: string | null;
  adminId: string | null;
  adminName: string | null;
};

const ADMIN_NODE_KEY = "spilled.private-node.admin.v1";

export type PrivateNodeStorageSummary = {
  accountId: string;
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
  profiles: Array<{ profileId: string; usedBytes: number }>;
};

const PRIVATE_NODE_KEY = "spilled.private-node.connection.v1";

function normalizeNodeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function privateFetch<T>(nodeUrl: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${normalizeNodeUrl(nodeUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "bypass-tunnel-reminder": "true",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload?.error ?? `Private node request failed (${response.status}).`);
  }
  return payload;
}

export function readPrivateNodeConnection(): PrivateNodeConnection {
  if (typeof window === "undefined") {
    return {
      nodeUrl: "",
      token: null,
      accountId: null,
      profileId: null,
      accountName: null,
      profileName: null,
    };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRIVATE_NODE_KEY) || "{}") as Partial<PrivateNodeConnection>;
    return {
      nodeUrl: typeof parsed.nodeUrl === "string" ? parsed.nodeUrl : "",
      token: typeof parsed.token === "string" ? parsed.token : null,
      accountId: typeof parsed.accountId === "string" ? parsed.accountId : null,
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : null,
      accountName: typeof parsed.accountName === "string" ? parsed.accountName : null,
      profileName: typeof parsed.profileName === "string" ? parsed.profileName : null,
    };
  } catch {
    return {
      nodeUrl: "",
      token: null,
      accountId: null,
      profileId: null,
      accountName: null,
      profileName: null,
    };
  }
}

export function writePrivateNodeConnection(connection: PrivateNodeConnection) {
  if (typeof window === "undefined") {
    return connection;
  }
  window.localStorage.setItem(PRIVATE_NODE_KEY, JSON.stringify(connection));
  return connection;
}

export function clearPrivateNodeConnection() {
  const next: PrivateNodeConnection = {
    nodeUrl: "",
    token: null,
    accountId: null,
    profileId: null,
    accountName: null,
    profileName: null,
  };
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PRIVATE_NODE_KEY);
  }
  return next;
}

export async function fetchPrivateNodeStatus(nodeUrl: string) {
  return privateFetch<{
    status: "ok";
    node?: {
      mode?: string;
      nodeId?: string;
      endpointUrl?: string | null;
      capabilities?: Record<string, { visibility?: string; requiresSession?: boolean }>;
    };
    auth?: {
      privateAuthEnabled?: boolean;
      passkeysEnabled?: boolean;
      setupRequired?: boolean;
      adminPasswordEnabled?: boolean;
      watcherPasswordEnabled?: boolean;
      oidcProviders?: Array<{ providerId: string; displayName: string }>;
    };
    capabilities?: Record<string, boolean>;
    storage?: { privateStorageEnabled?: boolean; totalUsedBytes?: number; quotaBytes?: number | null };
  }>(nodeUrl, "/api/status", {
    method: "GET",
  });
}

async function findDiscoveryNodeOrigins() {
  try {
    const response = await fetch("/api/server/discovery/nodes?capability=fetch&limit=20", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json() as {
      candidates?: Array<{
        record?: {
          endpoints?: Array<{ protocol?: string; url?: string }>;
        };
      }>;
    };
    return (payload.candidates ?? [])
      .flatMap((candidate) => candidate.record?.endpoints ?? [])
      .map((endpoint) => endpoint.url?.replace(/\/$/, "") ?? "")
      .filter((url) => /^https?:\/\//i.test(url));
  } catch {
    return [];
  }
}

async function tryPrivateNodeStatus(nodeUrl: string) {
  try {
    return {
      nodeUrl: normalizeNodeUrl(nodeUrl),
      status: await fetchPrivateNodeStatus(nodeUrl),
    };
  } catch {
    return null;
  }
}

export async function findPrivateNodeCandidates(existingOrigins: string[] = []) {
  const origins = Array.from(new Set([
    ...existingOrigins,
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    ...(await findDiscoveryNodeOrigins()),
  ].map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean)));

  const settled = await Promise.all(origins.map((origin) => tryPrivateNodeStatus(origin)));
  return settled
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.status.auth?.setupRequired || entry.status.auth?.privateAuthEnabled || entry.status.node?.mode === "full");
}

export async function fetchPrivateNodeSetupStatus(nodeUrl: string) {
  return privateFetch<{
    enabled: boolean;
    setupRequired: boolean;
    reason: "missing-config" | "missing-admin" | "missing-admin-login" | "complete";
    setupCode: null;
    configPath: string;
    publicEndpointUrl?: string | null;
  }>(nodeUrl, "/api/node/setup/status", {
    method: "GET",
  });
}

export async function completePrivateNodeSetup(input: {
  nodeUrl: string;
  setupCode: string;
  nodeName: string;
  admin: { adminId: string; displayName: string; password: string };
  publicCapabilities: Record<string, boolean>;
  initialWatchers: Array<{
    watcherId: string;
    displayName: string;
    password?: string;
    quotaBytes: number;
    profiles: Array<{ profileId: string; displayName: string; avatar?: string }>;
  }>;
}) {
  return privateFetch<{
    ok: boolean;
    configPath: string;
    admin?: { adminId: string; displayName: string };
    accounts: PrivateNodeAccount[];
  }>(input.nodeUrl, "/api/node/setup/complete", {
    method: "POST",
    body: JSON.stringify({
      setupCode: input.setupCode,
      dashboardOrigin: window.location.origin,
      nodeName: input.nodeName,
      admin: input.admin,
      publicCapabilities: input.publicCapabilities,
      initialWatchers: input.initialWatchers,
    }),
  });
}

export async function fetchPrivateNodeAccounts(nodeUrl: string) {
  const payload = await privateFetch<{ accounts: PrivateNodeAccount[] }>(nodeUrl, "/api/node/auth/accounts", {
    method: "GET",
  });
  return payload.accounts;
}

export function readAdminNodeConnection(): AdminNodeConnection {
  if (typeof window === "undefined") {
    return { nodeUrl: "", token: null, adminId: null, adminName: null };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ADMIN_NODE_KEY) || "{}") as Partial<AdminNodeConnection>;
    return {
      nodeUrl: typeof parsed.nodeUrl === "string" ? parsed.nodeUrl : "",
      token: typeof parsed.token === "string" ? parsed.token : null,
      adminId: typeof parsed.adminId === "string" ? parsed.adminId : null,
      adminName: typeof parsed.adminName === "string" ? parsed.adminName : null,
    };
  } catch {
    return { nodeUrl: "", token: null, adminId: null, adminName: null };
  }
}

export function writeAdminNodeConnection(connection: AdminNodeConnection) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ADMIN_NODE_KEY, JSON.stringify(connection));
  }
  return connection;
}

export function clearAdminNodeConnection() {
  const next = { nodeUrl: "", token: null, adminId: null, adminName: null };
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ADMIN_NODE_KEY);
  }
  return next;
}

export async function loginAdminNodePassword(input: { nodeUrl: string; adminId: string; password: string }) {
  return privateFetch<{
    token: string;
    admin: { adminId: string; displayName: string };
    session: { expiresAt: number };
  }>(input.nodeUrl, "/api/node/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ adminId: input.adminId, password: input.password }),
  });
}

export async function fetchAdminNodeStatus(nodeUrl: string, token: string) {
  return privateFetch<{
    status: Awaited<ReturnType<typeof fetchPrivateNodeStatus>>;
    admins: Array<{ adminId: string; displayName: string; hasPassword?: boolean; passkeyCount?: number }>;
    watchers: PrivateNodeAccount[];
    sessions: Array<{ sessionId: string; kind: string; expiresAt: number; pairedDeviceId?: string }>;
    storage: { root: string | null; usedBytes: number; downloadsCount: number };
  }>(nodeUrl, "/api/node/admin/status", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function saveAdminNodeCapabilities(nodeUrl: string, token: string, publicCapabilities: Record<string, boolean>) {
  return privateFetch<{ ok: boolean; publicCapabilities: Record<string, boolean> }>(nodeUrl, "/api/node/admin/settings/capabilities", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(publicCapabilities),
  });
}

export async function createAdminWatcher(input: {
  nodeUrl: string;
  token: string;
  watcherId: string;
  displayName: string;
  password?: string;
  quotaBytes: number;
  profiles: Array<{ profileId: string; displayName: string; avatar?: string }>;
}) {
  return privateFetch<{ watcher: PrivateNodeAccount }>(input.nodeUrl, "/api/node/admin/accounts/watchers", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({
      watcherId: input.watcherId,
      displayName: input.displayName,
      password: input.password,
      quotaBytes: input.quotaBytes,
      profiles: input.profiles,
    }),
  });
}

export async function loginWatcherNodePassword(input: {
  nodeUrl: string;
  watcherId: string;
  password: string;
  profileId?: string | null;
}) {
  return privateFetch<{
    token: string;
    account: { accountId: string; watcherId?: string; displayName: string };
    profiles: Array<{ profileId: string; displayName: string }>;
    session: { profileId?: string | null };
  }>(input.nodeUrl, "/api/node/watcher/auth/login", {
    method: "POST",
    body: JSON.stringify({
      watcherId: input.watcherId,
      password: input.password,
      profileId: input.profileId ?? undefined,
    }),
  });
}

export async function enrollPrivateNodePasskey(input: {
  nodeUrl: string;
  accountId: string;
  setupSecret: string;
}) {
  const origin = window.location.origin;
  const optionsPayload = await privateFetch<{ options: unknown }>(input.nodeUrl, "/api/node/auth/passkey/register-options", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      setupSecret: input.setupSecret,
      origin,
    }),
  });
  const response = await startRegistration({ optionsJSON: optionsPayload.options as never });
  return privateFetch<{
    token: string;
    account: { accountId: string; displayName: string };
    profiles: Array<{ profileId: string; displayName: string }>;
    session: { profileId?: string | null };
  }>(input.nodeUrl, "/api/node/auth/passkey/register-verify", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      origin,
      response,
    }),
  });
}

export async function loginPrivateNodePasskey(input: {
  nodeUrl: string;
  accountId: string;
  profileId?: string | null;
}) {
  const origin = window.location.origin;
  const optionsPayload = await privateFetch<{ options: unknown }>(input.nodeUrl, "/api/node/auth/passkey/login-options", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      origin,
    }),
  });
  const response = await startAuthentication({ optionsJSON: optionsPayload.options as never });
  return privateFetch<{
    token: string;
    account: { accountId: string; displayName: string };
    profiles: Array<{ profileId: string; displayName: string }>;
    session: { profileId?: string | null };
  }>(input.nodeUrl, "/api/node/auth/passkey/login-verify", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      profileId: input.profileId ?? undefined,
      origin,
      response,
    }),
  });
}

export async function fetchPrivateNodeStorage(nodeUrl: string, token: string) {
  return privateFetch<PrivateNodeStorageSummary>(nodeUrl, "/api/node/private/storage", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function selectPrivateNodeProfile(input: {
  nodeUrl: string;
  token: string;
  profileId: string;
}) {
  return privateFetch<{
    token: string;
    account: { accountId: string; displayName: string };
    profiles: Array<{ profileId: string; displayName: string }>;
    session: { profileId?: string | null };
  }>(input.nodeUrl, "/api/node/private/profile/select", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({ profileId: input.profileId }),
  });
}

export async function registerPrivateNodeDownload(input: {
  nodeUrl: string;
  token: string;
  profileId: string;
  downloadId: string;
  episodeId: string;
  contentId: string;
  fileName: string;
  filePath: string;
  sizeBytes?: number;
  mimeType?: string;
}) {
  return privateFetch<{ download: unknown }>(input.nodeUrl, "/api/node/private/downloads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      downloadId: input.downloadId,
      profileId: input.profileId,
      episodeId: input.episodeId,
      contentId: input.contentId,
      fileName: input.fileName,
      filePath: input.filePath,
      sizeBytes: input.sizeBytes ?? 0,
      mimeType: input.mimeType ?? "video/mp4",
      spillshareEnabled: false,
    }),
  });
}
