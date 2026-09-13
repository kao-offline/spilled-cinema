import type { EpisodePreview } from "./import-client";

const EPISODE_PREVIEW_VAULT = "spilled-episode-preview-vault-v1";
const MAX_MEMORY_IMAGES = 80;
const memoryImages = new Map<string, string>();
const inflightImages = new Map<string, Promise<string>>();

function remember(sourceUrl: string, objectUrl: string) {
  const previous = memoryImages.get(sourceUrl);
  if (previous && previous !== objectUrl) URL.revokeObjectURL(previous);
  memoryImages.delete(sourceUrl);
  memoryImages.set(sourceUrl, objectUrl);
  while (memoryImages.size > MAX_MEMORY_IMAGES) {
    const oldest = memoryImages.entries().next().value as [string, string] | undefined;
    if (!oldest) break;
    memoryImages.delete(oldest[0]);
    URL.revokeObjectURL(oldest[1]);
  }
  return objectUrl;
}

async function decodeImage(url: string) {
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { /* The cached blob can still be used by img. */ }
}

async function loadPreviewIntoVault(sourceUrl: string): Promise<string> {
  const remembered = memoryImages.get(sourceUrl);
  if (remembered) {
    memoryImages.delete(sourceUrl);
    memoryImages.set(sourceUrl, remembered);
    return remembered;
  }
  const pending = inflightImages.get(sourceUrl);
  if (pending) return pending;

  const load = (async () => {
    // Stills live on third-party CDNs (e.g. TMDB) that do not send CORS
    // headers. no-cors yields an opaque response with no headers and status 0,
    // which is still cacheable and perfectly displayable through <img> — while
    // a cors fetch only litters the console with blocked-by-CORS errors.
    const fetchOpaque = () => fetch(sourceUrl, { mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer" });
    let response: Response | undefined;
    if ("caches" in window) {
      const vault = await caches.open(EPISODE_PREVIEW_VAULT);
      response = await vault.match(sourceUrl) ?? undefined;
      if (!response) {
        const fetched = await fetchOpaque();
        if (!fetched.ok && fetched.type !== "opaque") throw new Error(`Episode preview returned ${fetched.status}.`);
        response = fetched;
        await vault.put(sourceUrl, fetched.clone());
      }
    } else {
      response = await fetchOpaque();
      if (!response.ok && response.type !== "opaque") throw new Error(`Episode preview returned ${response.status}.`);
    }
    const objectUrl = remember(sourceUrl, URL.createObjectURL(await response.blob()));
    await decodeImage(objectUrl);
    return objectUrl;
  })().finally(() => inflightImages.delete(sourceUrl));
  inflightImages.set(sourceUrl, load);
  return load;
}

export async function prefetchEpisodePreviewImages(previews: EpisodePreview[]): Promise<EpisodePreview[]> {
  const results = new Array<EpisodePreview>(previews.length);
  let cursor = 0;
  async function worker() {
    while (cursor < previews.length) {
      const index = cursor++;
      const preview = previews[index];
      if (!preview.stillUrl) { results[index] = preview; continue; }
      try {
        results[index] = { ...preview, stillUrl: await loadPreviewIntoVault(preview.stillUrl) };
      } catch {
        results[index] = preview;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, previews.length) }, () => worker()));
  return results;
}
