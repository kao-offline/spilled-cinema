import type { IntegrationId } from "./integrations";
import type { ImportedShow } from "./types";

export type ImportGateDecision = "started" | "duplicate" | "busy";

type ImportCandidate = {
  provider: IntegrationId;
  importSlug: string;
  availability?: string;
};

export function importSourceKey(provider: IntegrationId, slug: string) {
  return `${provider}:${slug.trim().toLowerCase()}`;
}

export function createImportGate() {
  let activeKey: string | null = null;
  return {
    request(key: string): ImportGateDecision {
      if (activeKey === key) return "duplicate";
      if (activeKey !== null) return "busy";
      activeKey = key;
      return "started";
    },
    release(key: string) {
      if (activeKey === key) activeKey = null;
    },
    activeKey() {
      return activeKey;
    },
  };
}

export function selectPrimaryImportSource<T extends ImportCandidate>(
  sources: readonly T[],
  preferred: Pick<ImportCandidate, "provider" | "importSlug">,
) {
  return [...sources]
    .filter((source) => source.availability !== "unavailable")
    .sort((left, right) => {
      if (left.provider === preferred.provider && left.importSlug === preferred.importSlug) return -1;
      if (right.provider === preferred.provider && right.importSlug === preferred.importSlug) return 1;
      if (left.provider === "vidking" && right.provider !== "vidking") return 1;
      if (right.provider === "vidking" && left.provider !== "vidking") return -1;
      return 0;
    })[0] ?? null;
}

export function findImportedShowBySource(
  shows: readonly ImportedShow[],
  provider: IntegrationId,
  rawSlug: string,
) {
  const slug = rawSlug.trim().toLowerCase();
  return shows.find((show) => {
    if (show.providerMatches?.some((match) =>
      match.integrationId === provider && match.providerItemId.trim().toLowerCase() === slug
    )) return true;

    if (provider === "vidking" || provider === "cineby") {
      const match = slug.match(/^(movie|tv)\/(\d+)/i);
      return match ? show.slug === `${provider}-${match[1].toLowerCase()}-${match[2]}` : show.slug === slug;
    }
    if (provider === "bombuj") return show.slug === `bombuj-${slug}`;
    return show.slug === slug;
  }) ?? null;
}
