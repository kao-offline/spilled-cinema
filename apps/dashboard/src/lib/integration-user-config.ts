const INTEGRATION_USER_KEYS_KEY = "spilled.integrations.user-keys.v1";
const INTEGRATION_USER_CREDENTIALS_KEY = "spilled.integrations.user-credentials.v1";

export type IntegrationUserKeys = Record<string, string>;
export type IntegrationUserCredentials = Record<string, {
  username?: string;
  password?: string;
}>;

export function readIntegrationUserKeys(): IntegrationUserKeys {
  try {
    const parsed = JSON.parse(localStorage.getItem(INTEGRATION_USER_KEYS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function writeIntegrationUserKeys(keys: IntegrationUserKeys) {
  localStorage.setItem(INTEGRATION_USER_KEYS_KEY, JSON.stringify(keys));
}

export function readIntegrationUserCredentials(): IntegrationUserCredentials {
  try {
    const parsed = JSON.parse(localStorage.getItem(INTEGRATION_USER_CREDENTIALS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => {
          if (!value || typeof value !== "object") {
            return null;
          }
          const record = value as Record<string, unknown>;
          const username = typeof record.username === "string" ? record.username : "";
          const password = typeof record.password === "string" ? record.password : "";
          return [key, { username, password }] as const;
        })
        .filter((entry): entry is readonly [string, { username: string; password: string }] => Boolean(entry)),
    );
  } catch {
    return {};
  }
}

export function writeIntegrationUserCredentials(credentials: IntegrationUserCredentials) {
  localStorage.setItem(INTEGRATION_USER_CREDENTIALS_KEY, JSON.stringify(credentials));
}

export function readSvetSerialuCredentials() {
  const credentials = readIntegrationUserCredentials().svetserialu;
  const username = credentials?.username?.trim() ?? "";
  const password = credentials?.password ?? "";
  return username && password ? { username, password } : undefined;
}
