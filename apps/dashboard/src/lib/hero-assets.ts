const heroImagePromiseCache = new Map<string, Promise<HTMLImageElement>>();
const heroLogoAspectCache = new Map<string, number>();

function canUseDom() {
  return typeof window !== "undefined" && typeof Image !== "undefined";
}

export function getCachedHeroLogoAspect(url: string | null | undefined) {
  if (!url) {
    return null;
  }
  return heroLogoAspectCache.get(url) ?? null;
}

export function preloadHeroImage(url: string | null | undefined) {
  if (!url || !canUseDom()) {
    return Promise.resolve(null);
  }

  const cached = heroImagePromiseCache.get(url);
  if (cached) {
    return cached;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.fetchPriority = "high";
    image.onload = async () => {
      try {
        if (typeof image.decode === "function") {
          await image.decode().catch(() => undefined);
        }
      } finally {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          heroLogoAspectCache.set(url, image.naturalWidth / image.naturalHeight);
        }
        resolve(image);
      }
    };
    image.onerror = () => {
      heroImagePromiseCache.delete(url);
      reject(new Error(`Failed to preload hero asset: ${url}`));
    };
    image.src = url;
  });

  heroImagePromiseCache.set(url, promise);
  return promise;
}
