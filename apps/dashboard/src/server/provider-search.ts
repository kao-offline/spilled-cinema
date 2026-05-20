import type { ExploreItem } from "../lib/types";
import { getProviderModuleAdapter } from "./provider-modules";

export async function searchProviderModule(input: { moduleId: string; query: string }): Promise<ExploreItem[]> {
  const adapter = getProviderModuleAdapter(input.moduleId);
  if (!adapter?.search) {
    throw new Error(`Provider module "${input.moduleId}" does not expose search.`);
  }

  return await adapter.search(input.query);
}
