import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const secretStatusValidator = v.union(v.literal("active"), v.literal("disabled"), v.literal("testing"));

const publicConfigValidator = v.object({
  integrationId: v.string(),
  enabled: v.boolean(),
  priority: v.number(),
  defaultLocale: v.optional(v.string()),
  sharedKeyAvailable: v.boolean(),
});

const artworkSharedKeysValidator = v.object({
  tmdbApiKey: v.optional(v.string()),
  fanartApiKey: v.optional(v.string()),
  tvdbApiKey: v.optional(v.string()),
});

const ARTWORK_SECRET_INTEGRATIONS = [
  { key: "tmdbApiKey", integrationId: "tmdb", priority: 10 },
  { key: "fanartApiKey", integrationId: "fanart", priority: 20 },
  { key: "tvdbApiKey", integrationId: "tvdb", priority: 30 },
] as const;

function adminAllowlist() {
  return (process.env.SPILLED_INTEGRATION_ADMINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function requireAdmin(ctx: { auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string; email?: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required.");
  }

  const allowlist = adminAllowlist();
  if (allowlist.length === 0) {
    throw new Error("Integration admin allowlist is not configured.");
  }

  if (!allowlist.includes(identity.tokenIdentifier) && (!identity.email || !allowlist.includes(identity.email))) {
    throw new Error("Integration admin access denied.");
  }

  return identity;
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function importMasterKey() {
  const raw = process.env.INTEGRATION_SECRET_MASTER_KEY;
  if (!raw) {
    throw new Error("INTEGRATION_SECRET_MASTER_KEY is not configured.");
  }
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return await crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importMasterKey();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  ));
  return `aes-gcm:v1:${bytesToBase64(iv)}:${bytesToBase64(encrypted)}`;
}

async function decryptSecret(ciphertext: string) {
  const [scheme, version, ivValue, encryptedValue] = ciphertext.split(":");
  if (scheme !== "aes-gcm" || version !== "v1" || !ivValue || !encryptedValue) {
    throw new Error("Unsupported secret ciphertext.");
  }
  const key = await importMasterKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivValue) },
    key,
    base64ToBytes(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

export const listPublicConfigs = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("integrationPublicConfigs").take(128);
  },
});

export const getSharedKeyStatus = query({
  args: {
    integrationId: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("integrationPublicConfigs")
      .withIndex("by_integration_id", (q) => q.eq("integrationId", args.integrationId))
      .unique();
    return {
      integrationId: args.integrationId,
      sharedKeyAvailable: Boolean(config?.sharedKeyAvailable && config.enabled),
    };
  },
});

export const adminListAuditEvents = query({
  args: {
    integrationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("integrationSecretAuditEvents")
      .withIndex("by_integration_id_and_created_at", (q) => q.eq("integrationId", args.integrationId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 50, 1), 100));
  },
});

export const upsertPublicConfig = mutation({
  args: {
    config: publicConfigValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("integrationPublicConfigs")
      .withIndex("by_integration_id", (q) => q.eq("integrationId", args.config.integrationId))
      .unique();
    const payload = {
      ...args.config,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("integrationPublicConfigs", payload);
  },
});

export const adminUpsertSecret = action({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
    plaintext: v.string(),
    keyVersion: v.optional(v.string()),
    status: v.optional(secretStatusValidator),
  },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const ciphertext = await encryptSecret(args.plaintext);
    await ctx.runMutation(internal.integrations.internalStoreSecret, {
      integrationId: args.integrationId,
      secretName: args.secretName,
      ciphertext,
      keyVersion: args.keyVersion ?? "v1",
      status: args.status ?? "active",
      updatedBy: identity.tokenIdentifier,
    });
    await ctx.runMutation(internal.integrations.internalRecordAuditEvent, {
      integrationId: args.integrationId,
      action: "adminUpsertSecret",
      actor: identity.tokenIdentifier,
      success: true,
    });
    return { ok: true };
  },
});

export const adminDisableSecret = mutation({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const existing = await ctx.db
      .query("integrationSecrets")
      .withIndex("by_integration_id_and_secret_name", (q) =>
        q.eq("integrationId", args.integrationId).eq("secretName", args.secretName))
      .unique();
    if (!existing) {
      throw new Error("Secret not found.");
    }
    await ctx.db.patch(existing._id, {
      status: "disabled",
      updatedAt: Date.now(),
      updatedBy: identity.tokenIdentifier,
    });
    await ctx.db.insert("integrationSecretAuditEvents", {
      integrationId: args.integrationId,
      action: "adminDisableSecret",
      actor: identity.tokenIdentifier,
      createdAt: Date.now(),
      success: true,
    });
    return { ok: true };
  },
});

export const adminTestSecret = action({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const plaintext = await ctx.runAction(internal.integrations.internalDecryptSecret, args);
    await ctx.runMutation(internal.integrations.internalRecordAuditEvent, {
      integrationId: args.integrationId,
      action: "adminTestSecret",
      actor: identity.tokenIdentifier,
      success: plaintext.length > 0,
    });
    return { ok: plaintext.length > 0 };
  },
});

export const resolveMetadataWithSharedKey = action({
  args: {
    integrationId: v.string(),
    title: v.string(),
    mediaType: v.union(v.literal("movie"), v.literal("series")),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.integrations.internalRecordUsage, {
      integrationId: args.integrationId,
      bucket: `metadata:${Math.floor(Date.now() / 60000)}`,
      limit: 60,
      resetAt: Date.now() + 60_000,
    });
    const hasSecret = await ctx.runQuery(internal.integrations.internalHasActiveSecret, {
      integrationId: args.integrationId,
      secretName: "apiKey",
    });
    await ctx.runMutation(internal.integrations.internalRecordAuditEvent, {
      integrationId: args.integrationId,
      action: "resolveMetadataWithSharedKey",
      actor: "public",
      success: hasSecret,
    });
    return {
      integrationId: args.integrationId,
      available: hasSecret,
      metadata: null,
    };
  },
});

export const resolveArtworkWithSharedKey = action({
  args: {
    integrationId: v.string(),
    title: v.string(),
    mediaType: v.union(v.literal("movie"), v.literal("series")),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.integrations.internalRecordUsage, {
      integrationId: args.integrationId,
      bucket: `artwork:${Math.floor(Date.now() / 60000)}`,
      limit: 60,
      resetAt: Date.now() + 60_000,
    });
    const hasSecret = await ctx.runQuery(internal.integrations.internalHasActiveSecret, {
      integrationId: args.integrationId,
      secretName: "apiKey",
    });
    await ctx.runMutation(internal.integrations.internalRecordAuditEvent, {
      integrationId: args.integrationId,
      action: "resolveArtworkWithSharedKey",
      actor: "public",
      success: hasSecret,
    });
    return {
      integrationId: args.integrationId,
      available: hasSecret,
      artwork: null,
    };
  },
});

export const internalStoreSecret = internalMutation({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
    ciphertext: v.string(),
    keyVersion: v.string(),
    status: secretStatusValidator,
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("integrationSecrets")
      .withIndex("by_integration_id_and_secret_name", (q) =>
        q.eq("integrationId", args.integrationId).eq("secretName", args.secretName))
      .unique();
    const payload = {
      ...args,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("integrationSecrets", payload);
  },
});

export const internalUpsertPublicConfig = internalMutation({
  args: {
    config: publicConfigValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("integrationPublicConfigs")
      .withIndex("by_integration_id", (q) => q.eq("integrationId", args.config.integrationId))
      .unique();
    const payload = {
      ...args.config,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("integrationPublicConfigs", payload);
  },
});

export const internalHasActiveSecret = internalQuery({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("integrationSecrets")
      .withIndex("by_integration_id_and_secret_name", (q) =>
        q.eq("integrationId", args.integrationId).eq("secretName", args.secretName))
      .unique();
    return secret?.status === "active";
  },
});

export const internalGetActiveSecret = internalQuery({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("integrationSecrets")
      .withIndex("by_integration_id_and_secret_name", (q) =>
        q.eq("integrationId", args.integrationId).eq("secretName", args.secretName))
      .unique();
    if (!secret || secret.status !== "active") {
      return null;
    }
    return {
      ciphertext: secret.ciphertext,
      keyVersion: secret.keyVersion,
    };
  },
});

export const internalDecryptSecret = internalAction({
  args: {
    integrationId: v.string(),
    secretName: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = await ctx.runQuery(internal.integrations.internalGetActiveSecret, args);
    if (!secret) {
      throw new Error("Active secret not found.");
    }
    return await decryptSecret(secret.ciphertext);
  },
});

export const internalResolveSharedArtworkApiKeys = internalAction({
  args: {},
  handler: async (ctx) => {
    const keys: {
      tmdbApiKey?: string;
      fanartApiKey?: string;
      tvdbApiKey?: string;
    } = {};

    for (const entry of ARTWORK_SECRET_INTEGRATIONS) {
      try {
        const secret = await ctx.runAction(internal.integrations.internalDecryptSecret, {
          integrationId: entry.integrationId,
          secretName: "apiKey",
        });
        if (secret.trim()) {
          keys[entry.key] = secret.trim();
        }
      } catch {
        // Missing or inactive shared keys are reported by omission.
      }
    }

    return keys;
  },
});

export const internalSeedSharedArtworkApiKeys = internalAction({
  args: {
    keys: artworkSharedKeysValidator,
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const seeded: string[] = [];

    for (const entry of ARTWORK_SECRET_INTEGRATIONS) {
      const plaintext = args.keys[entry.key]?.trim();
      if (!plaintext) {
        continue;
      }

      await ctx.runMutation(internal.integrations.internalStoreSecret, {
        integrationId: entry.integrationId,
        secretName: "apiKey",
        ciphertext: await encryptSecret(plaintext),
        keyVersion: "v1",
        status: "active",
        updatedBy: args.updatedBy,
      });
      await ctx.runMutation(internal.integrations.internalUpsertPublicConfig, {
        config: {
          integrationId: entry.integrationId,
          enabled: true,
          priority: entry.priority,
          sharedKeyAvailable: true,
        },
      });
      await ctx.runMutation(internal.integrations.internalRecordAuditEvent, {
        integrationId: entry.integrationId,
        action: "internalSeedSharedArtworkApiKeys",
        actor: args.updatedBy,
        success: true,
      });
      seeded.push(entry.integrationId);
    }

    return { ok: true, seeded };
  },
});

export const internalRecordAuditEvent = internalMutation({
  args: {
    integrationId: v.string(),
    action: v.string(),
    actor: v.string(),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("integrationSecretAuditEvents", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const internalRecordUsage = internalMutation({
  args: {
    integrationId: v.string(),
    bucket: v.string(),
    limit: v.number(),
    resetAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("integrationUsageBuckets")
      .withIndex("by_integration_id_and_bucket", (q) =>
        q.eq("integrationId", args.integrationId).eq("bucket", args.bucket))
      .unique();
    if (!existing || existing.resetAt <= Date.now()) {
      return await ctx.db.insert("integrationUsageBuckets", {
        integrationId: args.integrationId,
        bucket: args.bucket,
        count: 1,
        resetAt: args.resetAt,
      });
    }
    if (existing.count >= args.limit) {
      throw new Error("Integration shared-key rate limit exceeded.");
    }
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      resetAt: args.resetAt,
    });
    return existing._id;
  },
});
