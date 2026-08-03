import type { ImportedShow } from "../lib/types";
import { getProviderModuleAdapter } from "./provider-modules";
import { getRemoteProviderModuleAdapter } from "./remote-provider-modules";
import type { SvetSerialuCredentials } from "./svetserialu";

export async function importProviderModuleItem(input: {
  moduleId: string;
  slug: string;
  mediaType?: "movie" | "serial";
  repositoryUrls?: string[];
  svetserialuCredentials?: SvetSerialuCredentials | null;
}): Promise<ImportedShow> {
  const attachMediaType = (show: ImportedShow): ImportedShow => ({
    ...show,
    mediaType: input.mediaType ?? show.mediaType,
  });

  // Production connectors are compiled into the node. Repository manifests
  // may describe versions and metadata, but must never replace a built-in
  // adapter with remote executable JavaScript.
  const adapter = getProviderModuleAdapter(input.moduleId);
  if (adapter?.import) {
    return attachMediaType(await adapter.import(input.slug, input.mediaType, {
      svetserialuCredentials: input.svetserialuCredentials,
    }) as ImportedShow);
  }

  const remoteAdapter = await getRemoteProviderModuleAdapter({
    moduleId: input.moduleId,
    repositoryUrls: input.repositoryUrls,
  });
  if (remoteAdapter?.import) {
    return attachMediaType(await remoteAdapter.import(input.slug, input.mediaType) as ImportedShow);
  }

  throw new Error(`Provider module "${input.moduleId}" does not expose import.`);
}
