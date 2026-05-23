import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export type SpilledNodeMode = "public-fetch" | "private" | "full";

export type PrivateNodeProfileConfig = {
  profileId: string;
  displayName: string;
  avatar?: string;
};

export type PrivateNodeAccountConfig = {
  accountId: string;
  displayName: string;
  role: "admin" | "user";
  quotaBytes?: number;
  profiles: PrivateNodeProfileConfig[];
  allowedOidcSubjects?: string[];
  allowedEmails?: string[];
};

export type PrivateNodeOidcProviderConfig = {
  providerId: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecretEnv?: string;
  scopes?: string[];
};

export type PrivateNodeConfig = {
  privateNode: {
    enabled: boolean;
    nodeName?: string;
    setupSecretHash?: string;
    allowPublicFetch?: boolean;
    allowedOrigins?: string[];
  };
  accounts: PrivateNodeAccountConfig[];
  oidcProviders?: PrivateNodeOidcProviderConfig[];
  storage?: {
    root?: string;
    defaultAccountQuotaBytes?: number;
  };
};

export type LoadedPrivateNodeConfig = PrivateNodeConfig & {
  configPath: string;
  storageRoot: string;
};

const DEFAULT_ACCOUNT_QUOTA_BYTES = 200 * 1024 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

export function hashSetupSecret(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

export function verifySetupSecret(secret: string, setupSecretHash?: string) {
  if (!setupSecretHash) {
    return false;
  }
  return hashSetupSecret(secret) === setupSecretHash;
}

function normalizeConfig(raw: unknown, configPath: string): LoadedPrivateNodeConfig {
  if (!isRecord(raw)) {
    throw new Error("Private node config must be a JSON object.");
  }
  if (!isRecord(raw.privateNode)) {
    throw new Error("privateNode config is required.");
  }
  const accountsRaw = raw.accounts;
  if (!Array.isArray(accountsRaw) || accountsRaw.length === 0) {
    throw new Error("At least one private node account is required.");
  }

  const seenAccounts = new Set<string>();
  const seenProfiles = new Set<string>();
  const accounts: PrivateNodeAccountConfig[] = accountsRaw.map((entry, accountIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`accounts[${accountIndex}] must be an object.`);
    }
    const accountId = assertString(entry.accountId, `accounts[${accountIndex}].accountId`);
    if (seenAccounts.has(accountId)) {
      throw new Error(`Duplicate accountId ${accountId}.`);
    }
    seenAccounts.add(accountId);

    const profilesRaw = entry.profiles;
    if (!Array.isArray(profilesRaw) || profilesRaw.length === 0) {
      throw new Error(`Account ${accountId} must define at least one profile.`);
    }

    return {
      accountId,
      displayName: assertString(entry.displayName, `accounts[${accountIndex}].displayName`),
      role: entry.role === "admin" ? "admin" : "user",
      quotaBytes: entry.quotaBytes === undefined ? undefined : assertNumber(entry.quotaBytes, `accounts[${accountIndex}].quotaBytes`),
      profiles: profilesRaw.map((profile, profileIndex) => {
        if (!isRecord(profile)) {
          throw new Error(`profiles[${profileIndex}] for ${accountId} must be an object.`);
        }
        const profileId = assertString(profile.profileId, `profileId for ${accountId}`);
        const globalProfileKey = `${accountId}:${profileId}`;
        if (seenProfiles.has(globalProfileKey)) {
          throw new Error(`Duplicate profileId ${profileId} for ${accountId}.`);
        }
        seenProfiles.add(globalProfileKey);
        return {
          profileId,
          displayName: assertString(profile.displayName, `profile displayName for ${accountId}`),
          avatar: typeof profile.avatar === "string" ? profile.avatar : undefined,
        };
      }),
      allowedOidcSubjects: Array.isArray(entry.allowedOidcSubjects)
        ? entry.allowedOidcSubjects.filter((value): value is string => typeof value === "string")
        : [],
      allowedEmails: Array.isArray(entry.allowedEmails)
        ? entry.allowedEmails.filter((value): value is string => typeof value === "string")
        : [],
    };
  });

  const oidcProvidersRaw = raw.oidcProviders;
  const oidcProviders: PrivateNodeOidcProviderConfig[] = Array.isArray(oidcProvidersRaw)
    ? oidcProvidersRaw.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`oidcProviders[${index}] must be an object.`);
        }
        return {
          providerId: assertString(entry.providerId, `oidcProviders[${index}].providerId`),
          displayName: assertString(entry.displayName, `oidcProviders[${index}].displayName`),
          issuer: assertString(entry.issuer, `oidcProviders[${index}].issuer`),
          clientId: assertString(entry.clientId, `oidcProviders[${index}].clientId`),
          clientSecretEnv: typeof entry.clientSecretEnv === "string" ? entry.clientSecretEnv : undefined,
          scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((scope): scope is string => typeof scope === "string") : ["openid", "profile", "email"],
        };
      })
    : [];

  const storage = isRecord(raw.storage) ? raw.storage : {};
  const configuredRoot = typeof storage.root === "string" && storage.root.trim()
    ? storage.root.trim()
    : "./spilled-data";
  const storageRoot = resolve(configPath ? resolve(configPath, "..") : process.cwd(), configuredRoot);

  return {
    configPath,
    privateNode: {
      enabled: raw.privateNode.enabled === true,
      nodeName: typeof raw.privateNode.nodeName === "string" ? raw.privateNode.nodeName : "Private Node",
      setupSecretHash: typeof raw.privateNode.setupSecretHash === "string" ? raw.privateNode.setupSecretHash : undefined,
      allowPublicFetch: raw.privateNode.allowPublicFetch === true,
      allowedOrigins: Array.isArray(raw.privateNode.allowedOrigins)
        ? raw.privateNode.allowedOrigins.filter((origin): origin is string => typeof origin === "string")
        : [],
    },
    accounts,
    oidcProviders,
    storage: {
      root: configuredRoot,
      defaultAccountQuotaBytes: storage.defaultAccountQuotaBytes === undefined
        ? DEFAULT_ACCOUNT_QUOTA_BYTES
        : assertNumber(storage.defaultAccountQuotaBytes, "storage.defaultAccountQuotaBytes"),
    },
    storageRoot,
  };
}

export function readNodeModeFromEnv(): SpilledNodeMode {
  const mode = String(process.env.SPILLED_NODE_MODE || "public-fetch").trim();
  if (mode === "private" || mode === "full" || mode === "public-fetch") {
    return mode;
  }
  throw new Error(`Unsupported SPILLED_NODE_MODE "${mode}".`);
}

export function loadPrivateNodeConfigFromEnv(mode = readNodeModeFromEnv()): LoadedPrivateNodeConfig | null {
  const configPath = process.env.SPILLED_PRIVATE_CONFIG?.trim();
  if (!configPath) {
    if (mode === "private" || mode === "full") {
      throw new Error("SPILLED_PRIVATE_CONFIG is required when SPILLED_NODE_MODE is private or full.");
    }
    return null;
  }
  const resolvedPath = resolve(configPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Private node config not found at ${resolvedPath}.`);
  }
  const configText = readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, "");
  return normalizeConfig(JSON.parse(configText), resolvedPath);
}
