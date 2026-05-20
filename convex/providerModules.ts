import { v } from "convex/values";
import { query, internalMutation, type MutationCtx } from "./_generated/server";

const providerFeedKindValidator = v.union(
  v.literal("new-episodes"),
  v.literal("new-additions"),
  v.literal("popular"),
  v.literal("latest-episodes"),
  v.literal("custom"),
);

const providerFeedValidator = v.object({
  feedId: v.string(),
  title: v.string(),
  description: v.string(),
  kind: providerFeedKindValidator,
  defaultEnabled: v.boolean(),
  pageTitle: v.string(),
  supportsSearch: v.boolean(),
  supportsOpenSource: v.boolean(),
  supportsImport: v.boolean(),
  sortMode: v.literal("newest"),
  itemGranularity: v.union(v.literal("episode"), v.literal("show"), v.literal("movie")),
});

const providerCapabilitiesValidator = v.object({
  import: v.boolean(),
  player: v.boolean(),
  search: v.boolean(),
  download: v.boolean(),
  feeds: v.array(providerFeedValidator),
});

const providerModuleValidator = v.object({
  moduleId: v.string(),
  providerId: v.string(),
  displayName: v.string(),
  version: v.number(),
  status: v.union(v.literal("active"), v.literal("disabled")),
  capabilities: providerCapabilitiesValidator,
  publishedAt: v.number(),
  updatedAt: v.number(),
});

const defaultPublishedAt = Date.UTC(2026, 4, 8);

const DEFAULT_PROVIDER_MODULES = [
  {
    moduleId: "svetserialu",
    providerId: "svetserialu",
    displayName: "SvetSerialu",
    version: 1,
    status: "active" as const,
    capabilities: {
      import: true,
      player: true,
      search: true,
      download: true,
      feeds: [
        {
          feedId: "new-episodes",
          title: "New Episodes",
          description: "Recently added episodes from SvetSerialu, shown directly inside Spilled.",
          kind: "new-episodes" as const,
          defaultEnabled: false,
          pageTitle: "SvetSerialu New Episodes",
          supportsSearch: true,
          supportsOpenSource: true,
          supportsImport: true,
          sortMode: "newest" as const,
          itemGranularity: "episode" as const,
        },
      ],
    },
    publishedAt: defaultPublishedAt,
    updatedAt: defaultPublishedAt,
  },
];

async function upsertProviderModuleDocument(
  ctx: MutationCtx,
  record: {
    moduleId: string;
    providerId: string;
    displayName: string;
    version: number;
    status: "active" | "disabled";
    capabilities: {
      import: boolean;
      player: boolean;
      search: boolean;
      download: boolean;
      feeds: Array<{
        feedId: string;
        title: string;
        description: string;
        kind: "new-episodes" | "new-additions" | "popular" | "latest-episodes" | "custom";
        defaultEnabled: boolean;
        pageTitle: string;
        supportsSearch: boolean;
        supportsOpenSource: boolean;
        supportsImport: boolean;
        sortMode: "newest";
        itemGranularity: "episode" | "show" | "movie";
      }>;
    };
    publishedAt: number;
    updatedAt: number;
  },
) {
  const existing = await ctx.db
    .query("providerModules")
    .withIndex("by_module_id", (q) => q.eq("moduleId", record.moduleId))
    .unique();

  const payload = {
    ...record,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }

  return await ctx.db.insert("providerModules", payload);
}

export const listActiveProviderModules = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("providerModules")
      .withIndex("by_status_and_provider_id", (q) => q.eq("status", "active"))
      .take(32);
  },
});

export const upsertProviderModule = internalMutation({
  args: {
    module: providerModuleValidator,
  },
  handler: async (ctx, args) => {
    return await upsertProviderModuleDocument(ctx, args.module);
  },
});

export const ensureDefaultProviderModules = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const moduleRecord of DEFAULT_PROVIDER_MODULES) {
      await upsertProviderModuleDocument(ctx, moduleRecord);
    }
    return { inserted: DEFAULT_PROVIDER_MODULES.length };
  },
});
