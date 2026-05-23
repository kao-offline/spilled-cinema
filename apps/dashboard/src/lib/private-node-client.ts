import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export type PrivateNodeAccount = {
  accountId: string;
  displayName: string;
  role: "admin" | "user";
  quotaBytes: number;
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
    node?: { mode?: string; nodeId?: string; endpointUrl?: string | null };
    auth?: {
      privateAuthEnabled?: boolean;
      passkeysEnabled?: boolean;
      oidcProviders?: Array<{ providerId: string; displayName: string }>;
    };
    capabilities?: Record<string, boolean>;
    storage?: { privateStorageEnabled?: boolean; totalUsedBytes?: number; quotaBytes?: number | null };
  }>(nodeUrl, "/api/status", {
    method: "GET",
  });
}

export async function fetchPrivateNodeAccounts(nodeUrl: string) {
  const payload = await privateFetch<{ accounts: PrivateNodeAccount[] }>(nodeUrl, "/api/node/auth/accounts", {
    method: "GET",
  });
  return payload.accounts;
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
