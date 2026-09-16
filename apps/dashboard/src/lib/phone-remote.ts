import { requestRuntimeJson } from "./local-api";
import { readRemoteBindings, type RemoteAction } from "./remote-bindings";

export type RemoteReceiverStatus = {
  port: number;
  reachable: boolean;
  latencyMs: number | null;
};

export type RemoteInfo = {
  ok: boolean;
  port: number;
  lanIp: string;
  lanReachable: boolean;
  remotePath: string;
  remoteUrl: string;
  remoteTransport?: "tunnel" | "lan";
  receiver: RemoteReceiverStatus;
};

export type RemoteCommand = {
  id: number;
  kind: "action" | "text" | "key";
  action?: RemoteAction;
  text?: string;
  key?: string;
  code?: string;
  at: number;
};

const PAIRING_KEY = "spilled.phone-remote.v1";
// Legacy LAN pairing (Spilled Server /remote page) keeps its own storage key:
// it stores a bare { token } while the hosted flow stores a full session, and
// sharing one key made each flow unreadable to the other.
const LEGACY_PAIRING_KEY = "spilled.phone-remote-lan.v1";
const PHONE_REMOTE_EDGE = "https://spilled-control-plane.hrdykrystof.workers.dev/server/phone-remote";

export type PhoneRemoteSession = {
  sessionId: string;
  secret: string;
  expiresAt: number;
};

function readStoredPairing(): PhoneRemoteSession | null {
  try {
    const raw = window.localStorage.getItem(PAIRING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PhoneRemoteSession>;
    return typeof parsed.sessionId === "string" && typeof parsed.secret === "string" && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now()
      ? { sessionId: parsed.sessionId, secret: parsed.secret, expiresAt: parsed.expiresAt }
      : null;
  } catch {
    return null;
  }
}

function readLegacyPairing(): { token: string } | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_PAIRING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ token: string }>;
    return typeof parsed.token === "string" && parsed.token.length > 0 ? { token: parsed.token } : null;
  } catch {
    return null;
  }
}

export function readPhoneRemoteToken(): string | null {
  if (typeof window === "undefined") return null;
  return readLegacyPairing()?.token ?? null;
}

export function readPhoneRemoteSession() {
  return typeof window === "undefined" ? null : readStoredPairing();
}

async function hostedRemoteRequest<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${PHONE_REMOTE_EDGE}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Phone remote session is unavailable.");
  return await response.json() as T;
}

export async function startHostedPhoneRemoteSession(): Promise<PhoneRemoteSession | null> {
  try {
    const session = await hostedRemoteRequest<PhoneRemoteSession>("start", {});
    if (!session.sessionId || !session.secret || !session.expiresAt) return null;
    window.localStorage.setItem(PAIRING_KEY, JSON.stringify(session));
    return session;
  } catch { return null; }
}

export async function closeHostedPhoneRemoteSession() {
  const session = readPhoneRemoteSession();
  try { window.localStorage.removeItem(PAIRING_KEY); } catch { /* best effort */ }
  if (!session) return;
  try { await hostedRemoteRequest("close", session); } catch { /* expiry is safe */ }
}

export function buildHostedPhoneRemoteUrl(session: PhoneRemoteSession) {
  const url = new URL("/api/remote", window.location.origin);
  url.searchParams.set("session", session.sessionId);
  url.searchParams.set("secret", session.secret);
  return url.toString();
}

export async function fetchRemoteInfo(): Promise<RemoteInfo | null> {
  try {
    const result = await requestRuntimeJson<RemoteInfo>("/api/remote/info");
    return result.ok ? (result.data as RemoteInfo) : null;
  } catch {
    return null;
  }
}

export async function pairPhoneRemote(fresh = false): Promise<string | null> {
  try {
    const result = await requestRuntimeJson<{ token?: string }>("/api/remote/pair", {
      method: "POST",
      body: { fresh },
    });
    const token = result.ok ? (result.data as { token?: string })?.token : undefined;
    if (!token) return null;
    window.localStorage.setItem(LEGACY_PAIRING_KEY, JSON.stringify({ token }));
    return token;
  } catch {
    return null;
  }
}

export async function unpairPhoneRemote(): Promise<void> {
  try {
    window.localStorage.removeItem(LEGACY_PAIRING_KEY);
  } catch {
    // Storage is best-effort; the server token still rotates below.
  }
  try {
    await requestRuntimeJson("/api/remote/unpair", { method: "POST", body: {} });
  } catch {
    // Already unpaired or unreachable — local state is what matters.
  }
}

export function buildPhoneRemoteUrl(info: Pick<RemoteInfo, "remoteUrl">, token: string) {
  return `${info.remoteUrl}?token=${encodeURIComponent(token)}`;
}

export async function pollPhoneRemote(
  token: string,
  cursor: number,
): Promise<{ cursor: number; commands: RemoteCommand[] } | null> {
  try {
    const query = new URLSearchParams({ token, cursor: String(Math.max(0, Math.floor(cursor))) });
    const result = await requestRuntimeJson<{ cursor: number; commands: RemoteCommand[] }>(
      `/api/remote/poll?${query.toString()}`,
    );
    if (!result.ok) return null;
    const data = result.data as { cursor?: number; commands?: RemoteCommand[] };
    return { cursor: typeof data.cursor === "number" ? data.cursor : cursor, commands: Array.isArray(data.commands) ? data.commands : [] };
  } catch {
    return null;
  }
}

export async function pollHostedPhoneRemote(session: PhoneRemoteSession, cursor: number) {
  try {
    return await hostedRemoteRequest<{ cursor: number; commands: RemoteCommand[] }>("poll", { ...session, after: cursor });
  } catch { return null; }
}

/** Phone actions speak RemoteAction; the TV replays the user's own key bindings. */
export function keyEventForRemoteAction(action: RemoteAction): { key: string; code: string } {
  const binding = readRemoteBindings()[action];
  return { key: binding.key || binding.code, code: binding.code || binding.key };
}
