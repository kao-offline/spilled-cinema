import type { ProviderFeedResponse } from "../lib/types";
import { getProviderModuleAdapter } from "./provider-modules";

export async function loadProviderFeed(input: {
  moduleId: string;
  feedId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<ProviderFeedResponse> {
  const adapter = getProviderModuleAdapter(input.moduleId);
  if (!adapter?.getFeed) {
    throw new Error(`Provider module "${input.moduleId}" does not expose a feed capability.`);
  }

  return await adapter.getFeed(input.feedId, {
    cursor: input.cursor ?? null,
    limit: input.limit,
  });
}
