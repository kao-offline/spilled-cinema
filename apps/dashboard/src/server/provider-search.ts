import type { ExploreItem } from "../lib/types";
import { getProviderModuleAdapter } from "./provider-modules";
import { getRemoteProviderModuleAdapter } from "./remote-provider-modules";
import type { SvetSerialuCredentials } from "./svetserialu";

export async function searchProviderModule(input: {
  moduleId: string;
  query: string;
  repositoryUrls?: string[];
  svetserialuCredentials?: SvetSerialuCredentials | null;
}): Promise<ExploreItem[]> {
  if (!(input.moduleId === "svetserialu" && input.svetserialuCredentials)) {
    const remoteAdapter = await getRemoteProviderModuleAdapter({
      moduleId: input.moduleId,
      repositoryUrls: input.repositoryUrls,
    });
    if (remoteAdapter?.search) {
      return await remoteAdapter.search(input.query);
    }
  }

  const adapter = getProviderModuleAdapter(input.moduleId);
  if (!adapter?.search) {
    throw new Error(`Provider module "${input.moduleId}" does not expose search.`);
  }

  return await adapter.search(input.query, {
    svetserialuCredentials: input.svetserialuCredentials,
  });
}
