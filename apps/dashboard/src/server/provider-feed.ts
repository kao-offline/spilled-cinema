import type { ProviderFeedResponse } from "../lib/types";
import { getProviderModuleAdapter } from "./provider-modules";
import { getRemoteProviderModuleAdapter } from "./remote-provider-modules";
import type { SvetSerialuCredentials } from "./svetserialu";

export async function loadProviderFeed(input: {
  moduleId: string;
  feedId: string;
  cursor?: string | null;
  limit?: number;
  repositoryUrls?: string[];
  svetserialuCredentials?: SvetSerialuCredentials | null;
}): Promise<ProviderFeedResponse> {
  if (!(input.moduleId === "svetserialu" && input.svetserialuCredentials)) {
    const remoteAdapter = await getRemoteProviderModuleAdapter({
      moduleId: input.moduleId,
      repositoryUrls: input.repositoryUrls,
    });
    if (remoteAdapter?.getFeed) {
      return await remoteAdapter.getFeed(input.feedId, {
        cursor: input.cursor ?? null,
        limit: input.limit,
      });
    }
  }

  const adapter = getProviderModuleAdapter(input.moduleId);
  if (!adapter?.getFeed) {
    throw new Error(`Provider module "${input.moduleId}" does not expose a feed capability.`);
  }

  return await adapter.getFeed(input.feedId, {
    cursor: input.cursor ?? null,
    limit: input.limit,
    svetserialuCredentials: input.svetserialuCredentials,
  });
}
