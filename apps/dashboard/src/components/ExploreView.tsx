import { ArrowUpRight, ChevronDown, ExternalLink, Filter, Layers3, LoaderCircle, Plus, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { DiscoveryItemCard } from "./DiscoveryItemCard";
import { DiscoveryRail } from "./DiscoveryRail";
import { fetchExplorePeopleSuggestions, type ExplorePersonSuggestion } from "../lib/discovery-client";
import { balancedBackgroundImage } from "../lib/image-resolution";
import type {
  ExploreAudioBucket,
  ExploreFeedResponse,
  ExploreFilters,
  ExploreItem,
  ExploreMediaType,
  ExplorePersonRole,
  ExploreSectionKey,
} from "../lib/types";
import type { IntegrationId } from "../lib/integrations";
import { showToast } from "../lib/toast";

type ExploreViewProps = {
  query: string;
  onQueryChange: (value: string) => void;
  feed: ExploreFeedResponse | null;
  loading: boolean;
  error: string | null;
  filters: ExploreFilters;
  onToggleProvider: (provider: IntegrationId) => void;
  onToggleMediaType: (mediaType: ExploreMediaType) => void;
  onToggleGenre: (genre: string) => void;
  onToggleNetwork: (network: string) => void;
  onToggleSection: (section: ExploreSectionKey) => void;
  onToggleAudio: (bucket: ExploreAudioBucket) => void;
  onChangeVaultFilter: (value: ExploreFilters["inVault"]) => void;
  onChangeAvailability: (value: ExploreFilters["availability"]) => void;
  onChangeYearMin: (value: string) => void;
  onChangeYearMax: (value: string) => void;
  onChangePersonQuery: (value: string) => void;
  onChangePersonRole: (value: ExplorePersonRole) => void;
  onSetFilters: (filters: ExploreFilters) => void;
  onResetFilters: () => void;
  onLoadMore: () => void;
  onImport: (item: ExploreItem) => void;
  onOpenVault: (item: ExploreItem) => void;
};

type DerivedSection = {
  key: string;
  title: string;
  subtitle?: string;
  count: number;
  items: ExploreItem[];
};

function normalizeFacetSearch(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function canonicalizeFacetLabel(value: string) {
  return normalizeFacetSearch(value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function dedupeItems(items: ExploreItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function createDerivedSection(key: string, title: string, subtitle: string, items: ExploreItem[], limit = 18): DerivedSection | null {
  const deduped = dedupeItems(items);
  if (deduped.length === 0) {
    return null;
  }

  return {
    key,
    title,
    subtitle,
    count: deduped.length,
    items: deduped.slice(0, limit),
  };
}

function filterFacetItems<T extends { label: string }>(items: T[], query: string) {
  const normalizedQuery = normalizeFacetSearch(query);
  if (!normalizedQuery) {
    return items;
  }

  // Split query into tokens and require every token to be present in the
  // canonicalized label. This handles multi-word queries and diacritics.
  const tokens = normalizedQuery
    .split(/\s+/)
    .map((t) => canonicalizeFacetLabel(t))
    .filter(Boolean);

  if (tokens.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const label = canonicalizeFacetLabel(item.label);
    return tokens.every((token) => label.includes(token));
  });
}

function mergeFacetCounts<T extends { key: string; label: string; count: number }>(
  items: T[],
  options?: {
    labelMap?: Partial<Record<string, string>>;
    include?: (item: T) => boolean;
    sort?: (left: T, right: T) => number;
    dedupeBy?: (item: T) => string;
  },
) {
  const merged = new Map<string, T>();

  for (const item of items) {
    if (options?.include && !options.include(item)) {
      continue;
    }

    const dedupeKey = options?.dedupeBy?.(item) ?? item.key;
    const existing = merged.get(dedupeKey);
    const label = options?.labelMap?.[item.key] ?? item.label;
    if (existing) {
      merged.set(dedupeKey, {
        ...existing,
        count: existing.count + item.count,
        label,
      });
      continue;
    }

    merged.set(dedupeKey, {
      ...item,
      label,
    });
  }

  const values = [...merged.values()];
  if (options?.sort) {
    return values.sort(options.sort);
  }
  return values.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function isUsefulGenreFacetLabel(label: string) {
  const normalized = label.trim();
  if (!normalized) {
    return false;
  }

  if (/\b(19|20)\d{2}\b/.test(normalized)) {
    return false;
  }

  if (normalized.includes(" - ")) {
    return false;
  }

  if (normalized.split(/\s+/).length > 4) {
    return false;
  }

  return true;
}

function buildGenreFacets(items: ExploreItem[], selectedGenres: string[]) {
  const facets = new Map<string, { key: string; label: string; count: number }>();

  for (const item of items) {
    for (const genre of item.genres) {
      const label = genre.trim();
      if (!isUsefulGenreFacetLabel(label)) {
        continue;
      }

      const key = canonicalizeFacetLabel(label);
      const existing = facets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        facets.set(key, { key, label, count: 1 });
      }
    }
  }

  for (const genre of selectedGenres) {
    const label = genre.trim();
    if (!label) {
      continue;
    }

    const key = canonicalizeFacetLabel(label);
    if (!facets.has(key)) {
      facets.set(key, { key, label, count: 0 });
    }
  }

  return [...facets.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function isAnimeItem(item: ExploreItem) {
  return item.genres.some((genre) => canonicalizeFacetLabel(genre).includes("anime"));
}

function extractCsfdRating(item: ExploreItem) {
  const source = [item.yearLabel, item.description].filter(Boolean).join(" ");
  const match = source.match(/CSFD\s*(\d{1,3})%/i);
  const value = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

const SECTION_FILTER_LABELS: Partial<Record<ExploreSectionKey, string>> = {
  newest: "Just Added",
  popular: "Popular Now",
  latestEpisodes: "Latest Episodes",
  topToday: "Today",
  topOverall: "Top Rated",
  novinky: "New Releases",
};

type AnimeMode = "mixed" | "no-anime" | "only-anime";
type ExploreSortMode = "recommended" | "year" | "title" | "csfd";

function QuickChip(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "default" | "warm";
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={clsx(
        "rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors",
        props.fullWidth ? "w-full text-center" : "shrink-0",
        props.active
          ? props.tone === "warm"
            ? "border-[#f0c87a]/28 bg-[#f0c87a] text-[#241808]"
            : "border-white/18 bg-white text-black"
          : "border-white/8 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/84",
      )}
    >
      {props.label}
    </button>
  );
}

function ActiveFilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/68"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  );
}

function renderFilterGroup<T extends string>(
  label: string,
  items: Array<{ key: T; label: string; count: number; provider?: IntegrationId }>,
  activeValues: readonly T[],
  onToggle: (value: T) => void,
) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      {label ? <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">{label}</div> : null}
      <div className="flex max-h-[11rem] flex-wrap gap-2 overflow-y-auto pr-1">
        {items.map((item) => {
          const active = activeValues.includes(item.key);
          return (
            <button
              key={`${item.provider ?? "all"}:${item.key}`}
              type="button"
              title={item.label}
              onClick={() => onToggle(item.key)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
                active
                  ? "border-white/18 bg-white text-black"
                  : "border-white/8 bg-white/[0.04] text-white/58 hover:bg-white/[0.08]",
              )}
            >
              {item.label} <span className={active ? "text-black/55" : "text-white/32"}>{item.count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PersonFilterPanel({
  personQuery,
  personRole,
  onChangePersonQuery,
  onChangePersonRole,
}: {
  personQuery?: string;
  personRole?: ExplorePersonRole;
  onChangePersonQuery: (value: string) => void;
  onChangePersonRole: (value: ExplorePersonRole) => void;
}) {
  const [personSuggestions, setPersonSuggestions] = useState<ExplorePersonSuggestion[]>([]);
  const [personLoading, setPersonLoading] = useState(false);
  const personInput = personQuery ?? "";
  const showPersonSuggestions = personInput.trim().length >= 2 && personSuggestions.length > 0;
  const personWrapperRef = useRef<HTMLDivElement | null>(null);
  const [personAnchorRect, setPersonAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const query = personInput.trim();
    if (query.length < 2) {
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      void fetchExplorePeopleSuggestions({
        query,
        role: personRole ?? "any",
        limit: 7,
      })
        .then((suggestions) => {
          if (active) {
            setPersonSuggestions(suggestions);
          }
        })
        .catch(() => {
          if (active) {
            setPersonSuggestions([]);
          }
        })
        .finally(() => {
          if (active) {
            setPersonLoading(false);
          }
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [personInput, personRole]);

  useEffect(() => {
    if (!showPersonSuggestions) {
      setPersonAnchorRect(null);
      return;
    }

    function updateRect() {
      setPersonAnchorRect(personWrapperRef.current?.getBoundingClientRect() ?? null);
    }

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [showPersonSuggestions, personSuggestions]);

  function handleInputChange(value: string) {
    onChangePersonQuery(value);
    if (value.trim().length < 2) {
      setPersonSuggestions([]);
      setPersonLoading(false);
      return;
    }
    setPersonLoading(true);
  }

  function clearPersonQuery() {
    setPersonSuggestions([]);
    setPersonLoading(false);
    onChangePersonQuery("");
  }

  function selectPersonSuggestion(suggestion: ExplorePersonSuggestion) {
    setPersonSuggestions([]);
    setPersonLoading(false);
    onChangePersonQuery(suggestion.name);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Cast</div>
        {personQuery ? (
          <button
            type="button"
            onClick={clearPersonQuery}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/52 hover:bg-white/[0.08]"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        ) : null}
      </div>

      <div ref={personWrapperRef} className={clsx("relative", showPersonSuggestions && "z-30")}>
        <div className="relative z-20 rounded-[24px] border border-white/8 bg-black/16 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/28" />
            <input
              type="text"
              value={personInput}
              onChange={(event) => handleInputChange(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 py-3 pl-11 pr-10 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/22"
              placeholder="Search actors or directors"
            />
            {personLoading ? <LoaderCircle className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/32" /> : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["any", "actor", "director"] as const).map((role) => (
              <QuickChip
                key={role}
                label={role === "any" ? "Any Credit" : role === "actor" ? "Actor" : "Director"}
                active={(personRole ?? "any") === role}
                onClick={() => onChangePersonRole(role)}
              />
            ))}
          </div>
        </div>

        {showPersonSuggestions && personAnchorRect
          ? createPortal(
              <div
                style={{
                  position: "fixed",
                  left: Math.max(8, personAnchorRect.left),
                  top: personAnchorRect.bottom + 12,
                  width: personAnchorRect.width,
                }}
                className="z-[140] max-h-[13rem] space-y-2 overflow-y-auto rounded-[22px] border border-white/10 bg-[#0f131a] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.4)]"
              >
                {personSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => selectPersonSuggestion(suggestion)}
                    className="flex w-full items-start justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-left transition-colors hover:bg-white/[0.08]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{suggestion.name}</div>
                      <div className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-white/42">
                        {suggestion.knownFor.length > 0 ? suggestion.knownFor.join(" / ") : suggestion.department ?? "TMDB database"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/52">
                      {suggestion.role === "any" ? suggestion.department ?? "person" : suggestion.role}
                    </span>
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </section>
  );
}

function ExploreFilterModal(props: {
  open: boolean;
  onClose: () => void;
  feed: ExploreFeedResponse | null;
  filters: ExploreFilters;
  activeFilterCount: number;
  genreFacetQuery: string;
  onGenreFacetQueryChange: (value: string) => void;
  onToggleProvider: (provider: IntegrationId) => void;
  onToggleMediaType: (mediaType: ExploreMediaType) => void;
  onToggleGenre: (genre: string) => void;
  onToggleSection: (section: ExploreSectionKey) => void;
  onToggleAudio: (bucket: ExploreAudioBucket) => void;
  onChangeVaultFilter: (value: ExploreFilters["inVault"]) => void;
  onChangeAvailability: (value: ExploreFilters["availability"]) => void;
  onChangeYearMin: (value: string) => void;
  onChangeYearMax: (value: string) => void;
  onChangePersonQuery: (value: string) => void;
  onChangePersonRole: (value: ExplorePersonRole) => void;
  onSetFilters: (filters: ExploreFilters) => void;
  onResetFilters: () => void;
  animeMode: AnimeMode;
  onChangeAnimeMode: (value: AnimeMode) => void;
  sortMode: ExploreSortMode;
  onChangeSortMode: (value: ExploreSortMode) => void;
}) {
  const { open, onClose } = props;
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);
  const genreDropdownRef = useRef<HTMLDivElement | null>(null);
  const genrePortalRef = useRef<HTMLDivElement | null>(null);
  const [genreAnchorRect, setGenreAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const mergedGenreFacets = useMemo(
    () => buildGenreFacets(props.feed?.items ?? [], props.filters.genres),
    [props.feed?.items, props.filters.genres],
  );
  const visibleGenreFacets = useMemo(
    () => filterFacetItems(mergedGenreFacets, props.genreFacetQuery),
    [mergedGenreFacets, props.genreFacetQuery],
  );

  useEffect(() => {
    if (!showGenreDropdown) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!genreDropdownRef.current?.contains(target) && !genrePortalRef.current?.contains(target)) {
        setShowGenreDropdown(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [showGenreDropdown]);

  useEffect(() => {
    if (!showGenreDropdown) {
      setGenreAnchorRect(null);
      return;
    }

    function updateRect() {
      setGenreAnchorRect(genreDropdownRef.current?.getBoundingClientRect() ?? null);
    }

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [showGenreDropdown, props.genreFacetQuery, visibleGenreFacets.length]);
  const mergedMediaTypeFacets = useMemo(
    () => mergeFacetCounts(props.feed?.facetCounts.mediaTypes ?? [], { include: (item) => item.count > 0 || props.filters.mediaTypes.includes(item.key as ExploreMediaType) }),
    [props.feed?.facetCounts.mediaTypes, props.filters.mediaTypes],
  );
  const mergedProviderFacets = useMemo(
    () => mergeFacetCounts(props.feed?.facetCounts.providers ?? [], { include: (item) => item.count > 0 || props.filters.providers.includes(item.key as IntegrationId) }),
    [props.feed?.facetCounts.providers, props.filters.providers],
  );
  const mergedAudioFacets = useMemo(
    () =>
      mergeFacetCounts(props.feed?.facetCounts.audioBuckets ?? [], {
        include: (item) => (item.key === "dubbing" || item.key === "subtitles") && (item.count > 0 || props.filters.audioBuckets.includes(item.key as ExploreAudioBucket)),
        labelMap: {
          dubbing: "Dubbed",
          subtitles: "Subtitles",
        },
      }),
    [props.feed?.facetCounts.audioBuckets, props.filters.audioBuckets],
  );
  const mergedSectionFacets = useMemo(
    () =>
      mergeFacetCounts(props.feed?.facetCounts.sections ?? [], {
        include: (item) => (item.key === "newest" || item.key === "popular" || item.key === "latestEpisodes") && (item.count > 0 || props.filters.sections.includes(item.key as ExploreSectionKey)),
        labelMap: SECTION_FILTER_LABELS,
      }),
    [props.feed?.facetCounts.sections, props.filters.sections],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[125] bg-black/68 backdrop-blur-md" onClick={onClose}>
      <div
        className="mx-auto mt-8 max-h-[calc(100vh-4rem)] w-[min(1120px,calc(100vw-2rem))] overflow-hidden rounded-[30px] border border-white/10 bg-[#12151c] shadow-[0_34px_100px_rgba(0,0,0,0.52)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/6 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/34">Filters</div>
                {props.activeFilterCount > 0 ? (
                  <div className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/48">
                    {props.activeFilterCount} active
                  </div>
                ) : null}
              </div>
              {props.activeFilterCount > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {props.filters.providers.map((provider) => (
                    <ActiveFilterPill key={`provider-${provider}`} label={provider === "svetserialu" ? "SvetSerialu" : "Bombuj"} onRemove={() => props.onToggleProvider(provider)} />
                  ))}
                  {props.filters.mediaTypes.map((mediaType) => (
                    <ActiveFilterPill key={`media-${mediaType}`} label={mediaType === "movie" ? "Movies" : "Series"} onRemove={() => props.onToggleMediaType(mediaType)} />
                  ))}
                  {props.filters.audioBuckets.map((bucket) => (
                    <ActiveFilterPill key={`audio-${bucket}`} label={bucket === "subtitles" ? "Subtitles" : bucket === "dubbing" ? "Dubbed" : bucket === "no_subtitles" ? "No subtitles" : "All audio"} onRemove={() => props.onToggleAudio(bucket)} />
                  ))}
                  {props.filters.genres.slice(0, 4).map((genre) => (
                    <ActiveFilterPill key={`genre-${genre}`} label={genre} onRemove={() => props.onToggleGenre(genre)} />
                  ))}
                  {props.filters.sections.map((section) => (
                    <ActiveFilterPill key={`section-${section}`} label={SECTION_FILTER_LABELS[section] ?? section} onRemove={() => props.onToggleSection(section)} />
                  ))}
                  {props.filters.inVault !== "all" ? <ActiveFilterPill label={props.filters.inVault === "yes" ? "In Vault" : "Outside Vault"} onRemove={() => props.onChangeVaultFilter("all")} /> : null}
                  {props.filters.availability !== "all" ? <ActiveFilterPill label="Available" onRemove={() => props.onChangeAvailability("all")} /> : null}
                  {props.animeMode !== "mixed" ? <ActiveFilterPill label={props.animeMode === "only-anime" ? "Only Anime" : "No Anime"} onRemove={() => props.onChangeAnimeMode("mixed")} /> : null}
                  {props.sortMode !== "recommended" ? <ActiveFilterPill label={props.sortMode === "csfd" ? "Sort: CSFD" : props.sortMode === "year" ? "Sort: Year" : "Sort: A-Z"} onRemove={() => props.onChangeSortMode("recommended")} /> : null}
                  {props.filters.personQuery?.trim() ? (
                    <ActiveFilterPill
                      label={`${props.filters.personRole === "director" ? "Director" : props.filters.personRole === "actor" ? "Actor" : "Person"}: ${props.filters.personQuery}`}
                      onRemove={() => props.onSetFilters({ ...props.filters, personQuery: "", personRole: "any" })}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  props.onResetFilters();
                  props.onChangeAnimeMode("mixed");
                  props.onChangeSortMode("recommended");
                  props.onGenreFacetQueryChange("");
                  setShowGenreDropdown(false);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-transparent px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52 transition-colors hover:bg-white/[0.06] hover:text-white/78"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white/70 transition-colors hover:bg-black/60 hover:text-white"
                aria-label="Close filters"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-6 py-6 sm:px-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            {props.feed ? (
              <>
                <div className="space-y-7">
                  <section className="space-y-4">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Basics</div>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <section className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Type</div>
                        <div className="grid gap-2">
                          {mergedMediaTypeFacets.map((item) => (
                            <QuickChip
                              key={`media-grid-${item.key}`}
                              label={`${item.label}${item.count ? ` ${item.count}` : ""}`}
                              active={props.filters.mediaTypes.includes(item.key as ExploreMediaType)}
                              onClick={() => props.onToggleMediaType(item.key as ExploreMediaType)}
                              fullWidth
                            />
                          ))}
                        </div>
                      </section>
                      <section className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Sources</div>
                        <div className="grid gap-2">
                          {mergedProviderFacets.map((item) => (
                            <QuickChip
                              key={`provider-grid-${item.key}`}
                              label={item.label}
                              active={props.filters.providers.includes(item.key as IntegrationId)}
                              onClick={() => props.onToggleProvider(item.key as IntegrationId)}
                              fullWidth
                            />
                          ))}
                        </div>
                      </section>
                      <section className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Availability</div>
                        <div className="grid gap-2">
                          <QuickChip label="Available now" active={props.filters.availability === "available"} onClick={() => props.onChangeAvailability(props.filters.availability === "available" ? "all" : "available")} fullWidth />
                          <QuickChip label="In vault" active={props.filters.inVault === "yes"} onClick={() => props.onChangeVaultFilter(props.filters.inVault === "yes" ? "all" : "yes")} fullWidth />
                          <QuickChip label="Outside vault" active={props.filters.inVault === "no"} onClick={() => props.onChangeVaultFilter(props.filters.inVault === "no" ? "all" : "no")} fullWidth />
                        </div>
                      </section>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <section className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Anime</div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <QuickChip label="Combo" active={props.animeMode === "mixed"} onClick={() => props.onChangeAnimeMode("mixed")} fullWidth />
                          <QuickChip label="No Anime" active={props.animeMode === "no-anime"} onClick={() => props.onChangeAnimeMode("no-anime")} fullWidth />
                          <QuickChip label="Only Anime" active={props.animeMode === "only-anime"} onClick={() => props.onChangeAnimeMode("only-anime")} fullWidth />
                        </div>
                      </section>
                      <section className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Sort</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <QuickChip label="Recommended" active={props.sortMode === "recommended"} onClick={() => props.onChangeSortMode("recommended")} fullWidth />
                          <QuickChip label="Year" active={props.sortMode === "year"} onClick={() => props.onChangeSortMode("year")} fullWidth />
                          <QuickChip label="A-Z" active={props.sortMode === "title"} onClick={() => props.onChangeSortMode("title")} fullWidth />
                          <QuickChip label="CSFD" active={props.sortMode === "csfd"} onClick={() => props.onChangeSortMode("csfd")} fullWidth />
                        </div>
                      </section>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                      <section className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Release Year</div>
                        <div className="flex items-center gap-3">
                          <label className="min-w-0 flex-1 space-y-2">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">From</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1900}
                              max={2099}
                              value={props.filters.yearMin ?? ""}
                              onChange={(event) => props.onChangeYearMin(event.target.value)}
                              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/22"
                              placeholder="1995"
                            />
                          </label>
                          <div className="pt-6 text-white/24">-</div>
                          <label className="min-w-0 flex-1 space-y-2">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">To</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1900}
                              max={2099}
                              value={props.filters.yearMax ?? ""}
                              onChange={(event) => props.onChangeYearMax(event.target.value)}
                              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/22"
                              placeholder="2026"
                            />
                          </label>
                        </div>
                      </section>
                      {renderFilterGroup("Audio", mergedAudioFacets as Array<{ key: ExploreAudioBucket; label: string; count: number; provider?: IntegrationId }>, props.filters.audioBuckets, props.onToggleAudio)}
                    </div>
                  </section>
                </div>

                <div className="space-y-7">
                  <section className="space-y-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Genres</div>
                    </div>
                    <div ref={genreDropdownRef} className="relative">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/24" />
                        <input
                          type="text"
                          value={props.genreFacetQuery}
                          onFocus={() => setShowGenreDropdown(true)}
                          onChange={(event) => {
                            props.onGenreFacetQueryChange(event.target.value);
                            setShowGenreDropdown(true);
                          }}
                          placeholder={props.filters.genres.length > 0 ? "Search genres" : "Choose genres"}
                          className="w-full rounded-2xl border border-white/10 bg-black/20 py-3 pl-10 pr-10 text-sm text-white outline-none transition-colors placeholder:text-white/32 focus:border-white/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGenreDropdown((value) => !value)}
                          className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/54 transition-colors hover:bg-white/[0.06] hover:text-white/84"
                          aria-label="Toggle genres"
                        >
                          <ChevronDown className={clsx("h-4 w-4 transition-transform", showGenreDropdown && "rotate-180")} />
                        </button>
                      </div>
                      {props.filters.genres.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {props.filters.genres.map((genre) => (
                            <ActiveFilterPill key={`selected-genre-${genre}`} label={genre} onRemove={() => props.onToggleGenre(genre)} />
                          ))}
                        </div>
                      ) : null}

                      {showGenreDropdown && genreAnchorRect
                        ? createPortal(
                            <div
                              ref={genrePortalRef}
                              style={{
                                position: "fixed",
                                left: Math.max(8, genreAnchorRect.left),
                                top: genreAnchorRect.bottom + 10,
                                width: genreAnchorRect.width,
                                zIndex: 130,
                              }}
                              className="rounded-[24px] border border-white/10 bg-[#0e1117] p-3 shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
                            >
                              <div className="max-h-[18rem] space-y-2 overflow-y-auto pr-1">
                                {visibleGenreFacets.map((facet) => {
                                  const active = props.filters.genres.some((genre) => canonicalizeFacetLabel(genre) === canonicalizeFacetLabel(facet.label));
                                  return (
                                    <button
                                      key={`genre-option-${facet.key}`}
                                      type="button"
                                      onClick={() => {
                                        props.onToggleGenre(facet.label);
                                        props.onGenreFacetQueryChange("");
                                        setShowGenreDropdown(false);
                                      }}
                                      className={clsx(
                                        "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors",
                                        active
                                          ? "border-white/18 bg-white text-black"
                                          : "border-white/8 bg-white/[0.04] text-white/68 hover:bg-white/[0.08]",
                                      )}
                                    >
                                      <span className="truncate">{facet.label}</span>
                                      <span className={clsx("shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em]", active ? "text-black/55" : "text-white/32")}>
                                        {facet.count}
                                      </span>
                                    </button>
                                  );
                                })}
                                {visibleGenreFacets.length === 0 ? (
                                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/42">No matching genres.</div>
                                ) : null}
                              </div>
                            </div>,
                            document.body,
                          )
                        : null}
                    </div>
                  </section>

                  <PersonFilterPanel
                    personQuery={props.filters.personQuery}
                    personRole={props.filters.personRole}
                    onChangePersonQuery={props.onChangePersonQuery}
                    onChangePersonRole={props.onChangePersonRole}
                  />

                  {mergedSectionFacets.length > 0
                    ? renderFilterGroup("Browse Focus", mergedSectionFacets as Array<{ key: ExploreSectionKey; label: string; count: number; provider?: IntegrationId }>, props.filters.sections, props.onToggleSection)
                    : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExploreItemModal({
  item,
  onClose,
  onImport,
  onOpenVault,
}: {
  item: ExploreItem | null;
  onClose: () => void;
  onImport: (item: ExploreItem) => void;
  onOpenVault: (item: ExploreItem) => void;
}) {
  useEffect(() => {
    if (!item) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (!item) {
    return null;
  }

  const artwork = item.backdropUrl ?? item.posterUrl ?? null;
  const metadata = [item.yearLabel, item.network, item.mediaType === "serial" ? item.episode?.episodeCode?.toUpperCase() : item.mediaType === "movie" ? "Movie" : "Series"].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-md" onClick={onClose}>
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/10 bg-[#12151c] shadow-[0_30px_100px_rgba(0,0,0,0.48)]" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white/72 transition-colors hover:bg-black/70 hover:text-white" aria-label="Close details">
          <X className="h-5 w-5" />
        </button>

        <div className="grid lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
          <div className="relative min-h-[18rem] overflow-hidden bg-[#10131a] lg:min-h-[33rem]">
            {artwork ? (
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={balancedBackgroundImage(artwork, item.backdropUrl ? "backdrop-thumb" : "poster-detail")}
              />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,12,0.16),rgba(7,9,12,0.26)_34%,rgba(7,9,12,0.78)_100%)]" />
          </div>

          <div className="relative p-6 sm:p-8">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/68">
                {item.provider === "svetserialu" ? "SvetSerialu" : "Bombuj"}
              </span>
              {item.inVault ? <span className="rounded-full border border-emerald-400/18 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">In Vault</span> : null}
              {item.availableNow ? <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-black">Live</span> : null}
            </div>

            <h3 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">{item.title}</h3>

            {metadata.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
                {metadata.map((entry) => (
                  <span key={entry}>{entry}</span>
                ))}
              </div>
            ) : null}

            <p className="mt-5 max-w-2xl text-sm leading-6 text-white/62">
              {item.description?.trim() || "No extended description is available for this source entry yet."}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {item.audioBuckets.includes("dubbing") ? <span className="rounded-full border border-emerald-400/18 bg-emerald-400/8 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-200">Dubbing</span> : null}
              {item.audioBuckets.includes("subtitles") ? <span className="rounded-full border border-sky-400/18 bg-sky-400/8 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-100">Subs</span> : null}
              {item.genres.slice(0, 4).map((genre) => (
                <span key={genre} className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/52">
                  {genre}
                </span>
              ))}
            </div>

            {item.recommendationReasons?.length ? (
              <div className="mt-7 rounded-[24px] border border-white/8 bg-black/16 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/34">Why This Surfaced</div>
                <div className="mt-3 space-y-2">
                  {item.recommendationReasons.slice(0, 2).map((reason) => (
                    <div key={`${reason.kind}:${reason.label}`} className="rounded-2xl border border-white/6 bg-white/[0.04] px-4 py-3 text-sm text-white/62">
                      <div className="font-medium text-white/84">{reason.label}</div>
                      {reason.detail ? <div className="mt-1 text-xs uppercase tracking-[0.16em] text-white/34">{reason.detail}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              {item.inVault ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenVault(item);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/82 transition-colors hover:bg-white/[0.08]"
                >
                  <Layers3 className="h-4 w-4" />
                  Open In Vault
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onImport(item);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-black transition-colors hover:bg-white/90"
                >
                  <Plus className="h-4 w-4" />
                  Add To Vault
                </button>
              )}

              <a
                href={item.detailUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <ExternalLink className="h-4 w-4" />
                Open Source
              </a>
            </div>

            {item.directors.length > 0 || item.actors.length > 0 ? (
              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                {item.directors.length > 0 ? (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Directors</div>
                    <p className="mt-2 text-sm leading-6 text-white/58">{item.directors.slice(0, 5).join(", ")}</p>
                  </div>
                ) : null}
                {item.actors.length > 0 ? (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">Cast</div>
                    <p className="mt-2 text-sm leading-6 text-white/58">{item.actors.slice(0, 8).join(", ")}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-8 flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
              <span>Click outside to close</span>
              <button type="button" onClick={onClose} className="inline-flex items-center gap-2 text-white/46 transition-colors hover:text-white/72">
                Close
                <ArrowUpRight className="h-3.5 w-3.5 rotate-45" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExploreView(props: ExploreViewProps) {
  useEffect(() => {
    if (props.error) showToast(props.error);
  }, [props.error]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ExploreItem | null>(null);
  const [genreFacetQuery, setGenreFacetQuery] = useState("");
  const [animeMode, setAnimeMode] = useState<AnimeMode>("mixed");
  const [sortMode, setSortMode] = useState<ExploreSortMode>("recommended");

  const itemsById = useMemo(() => new Map((props.feed?.items ?? []).map((item) => [item.id, item])), [props.feed]);

  const sections = useMemo(() => {
    const feed = props.feed;
    if (!feed) {
      return [];
    }

    const animeFilteredItems = feed.items.filter((item) => {
      if (animeMode === "mixed") {
        return true;
      }
      const anime = isAnimeItem(item);
      return animeMode === "only-anime" ? anime : !anime;
    });

    const sortedItems = [...animeFilteredItems].sort((left, right) => {
      if (sortMode === "title") {
        return left.title.localeCompare(right.title);
      }
      if (sortMode === "year") {
        const leftYear = Number.parseInt(left.year?.match(/\b(19|20)\d{2}\b/)?.[0] ?? "", 10);
        const rightYear = Number.parseInt(right.year?.match(/\b(19|20)\d{2}\b/)?.[0] ?? "", 10);
        return (Number.isFinite(rightYear) ? rightYear : -1) - (Number.isFinite(leftYear) ? leftYear : -1) || left.title.localeCompare(right.title);
      }
      if (sortMode === "csfd") {
        const leftRating = extractCsfdRating(left) ?? -1;
        const rightRating = extractCsfdRating(right) ?? -1;
        return rightRating - leftRating || (right.discoveryScore ?? 0) - (left.discoveryScore ?? 0);
      }
      return (right.discoveryScore ?? 0) - (left.discoveryScore ?? 0);
    });
    const baseSections = feed.sections
      .map((section) =>
        createDerivedSection(
          `section-${section.key}`,
          section.label,
          section.provider ? `${section.provider} lane` : "provider lane",
          section.itemIds
            .map((itemId) => itemsById.get(itemId))
            .filter(Boolean)
            .filter((item) => animeFilteredItems.some((candidate) => candidate.id === (item as ExploreItem).id)) as ExploreItem[],
        ),
      )
      .filter(Boolean) as DerivedSection[];

    const candidates = [
      props.query.trim()
        ? createDerivedSection("query-top", "Top Matches", "best hits from the live catalog", sortedItems)
        : createDerivedSection("picked", "Picked For You", "strongest matches from your current discovery stack", sortedItems),
      ...baseSections,
      createDerivedSection("ready-tonight", "Ready Tonight", "live now and still outside your vault", sortedItems.filter((item) => item.availableNow && !item.inVault)),
      createDerivedSection("worth-adding", "Worth Adding", "high-signal titles you still have not pulled into the vault", sortedItems.filter((item) => !item.inVault)),
      createDerivedSection("movie-sprint", "Movie Sprint", "feature films in the active stack", sortedItems.filter((item) => item.mediaType === "movie")),
      createDerivedSection("series-dive", "Series Dive", "returning shows and episodic pulls", sortedItems.filter((item) => item.mediaType === "serial")),
      createDerivedSection("dubbed-now", "Dubbed Now", "available titles with dubbed playback", sortedItems.filter((item) => item.availableNow && item.audioBuckets.includes("dubbing"))),
    ].filter(Boolean) as DerivedSection[];

    const consumed = new Set<string>();
    const finalized: DerivedSection[] = [];

    for (const candidate of candidates) {
      const freshItems = candidate.items.filter((item) => !consumed.has(item.id));
      const chosenItems = freshItems.length >= 6 ? freshItems : candidate.items.slice(0, 18);
      const uniqueChosen = dedupeItems(chosenItems);
      if (uniqueChosen.length < 4 && finalized.length > 0) {
        continue;
      }

      uniqueChosen.forEach((item) => consumed.add(item.id));
      finalized.push({
        ...candidate,
        items: uniqueChosen.slice(0, 18),
      });
    }

    if (finalized.length > 0) {
      return finalized;
    }

    const fallbackSection = createDerivedSection("filtered", "Filtered Catalog", "everything matching the active stack", sortedItems);
    return fallbackSection ? [fallbackSection] : [];
  }, [animeMode, itemsById, props.feed, props.query, sortMode]);

  const filters = props.filters;
  const activeFilterCount =
    filters.mediaTypes.length +
    filters.providers.length +
    filters.genres.length +
    filters.networks.length +
    filters.sections.length +
    filters.audioBuckets.length +
    (filters.inVault === "all" ? 0 : 1) +
    (filters.availability === "all" ? 0 : 1) +
    (filters.yearMin ? 1 : 0) +
    (filters.yearMax ? 1 : 0) +
    (filters.personQuery?.trim() ? 1 : 0) +
    (animeMode === "mixed" ? 0 : 1) +
    (sortMode === "recommended" ? 0 : 1);

  return (
    <>
      <div className="min-w-0 px-4 pb-28 pt-2 sm:px-6 sm:pb-12 lg:px-10">
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <QuickChip
              label="All Sources"
              active={filters.providers.length === 0}
              onClick={() => {
                if (filters.providers.includes("svetserialu")) props.onToggleProvider("svetserialu");
                if (filters.providers.includes("bombuj")) props.onToggleProvider("bombuj");
              }}
            />
            <QuickChip label="Movies" active={filters.mediaTypes.includes("movie")} onClick={() => props.onToggleMediaType("movie")} />
            <QuickChip label="Series" active={filters.mediaTypes.includes("serial")} onClick={() => props.onToggleMediaType("serial")} />
            <QuickChip label="Available" active={filters.availability === "available"} onClick={() => props.onChangeAvailability(filters.availability === "available" ? "all" : "available")} />
            <QuickChip label="In Vault" active={filters.inVault === "yes"} onClick={() => props.onChangeVaultFilter(filters.inVault === "yes" ? "all" : "yes")} />
            <button
              type="button"
              onClick={() => setShowFilterModal(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/72 transition-colors hover:bg-white/[0.08]"
            >
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 ? <span className="rounded-full bg-white/12 px-2 py-0.5 text-[9px]">{activeFilterCount}</span> : null}
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {activeFilterCount > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
                {filters.providers.map((provider) => (
                  <ActiveFilterPill key={`provider-${provider}`} label={provider === "svetserialu" ? "SvetSerialu" : "Bombuj"} onRemove={() => props.onToggleProvider(provider)} />
                ))}
                {filters.mediaTypes.map((mediaType) => (
                  <ActiveFilterPill key={`media-${mediaType}`} label={mediaType === "movie" ? "Movies" : "Series"} onRemove={() => props.onToggleMediaType(mediaType)} />
                ))}
                {filters.audioBuckets.map((bucket) => (
                  <ActiveFilterPill key={`audio-${bucket}`} label={bucket === "subtitles" ? "Subs" : bucket === "dubbing" ? "Dubbing" : "No Subs"} onRemove={() => props.onToggleAudio(bucket)} />
                ))}
                {filters.genres.slice(0, 5).map((genre) => (
                  <ActiveFilterPill key={`genre-${genre}`} label={genre} onRemove={() => props.onToggleGenre(genre)} />
                ))}
                {filters.networks.slice(0, 4).map((network) => (
                  <ActiveFilterPill key={`network-${network}`} label={network} onRemove={() => props.onToggleNetwork(network)} />
                ))}
                {filters.sections.map((section) => (
                  <ActiveFilterPill key={`section-${section}`} label={section} onRemove={() => props.onToggleSection(section)} />
                ))}
                {filters.inVault !== "all" ? <ActiveFilterPill label={filters.inVault === "yes" ? "In Vault" : "Outside Vault"} onRemove={() => props.onChangeVaultFilter("all")} /> : null}
                {filters.availability !== "all" ? <ActiveFilterPill label="Available" onRemove={() => props.onChangeAvailability("all")} /> : null}
                  {filters.personQuery?.trim() ? (
                    <ActiveFilterPill
                      label={`${filters.personRole === "director" ? "Director" : filters.personRole === "actor" ? "Actor" : "Person"}: ${filters.personQuery}`}
                      onRemove={() => props.onSetFilters({ ...filters, personQuery: "", personRole: "any" })}
                    />
                  ) : null}
            </div>
          ) : null}
        </div>

        {props.loading ? <div className="mb-6 text-sm text-white/45">Loading live provider catalog...</div> : null}

        <div className="min-w-0 space-y-10">
          {sections.map((section) => (
            <DiscoveryRail key={section.key} title={section.title} subtitle={section.subtitle} countLabel={`${section.count} titles`}>
              {section.items.map((item) => (
                <DiscoveryItemCard key={item.id} item={item} onClick={setSelectedItem} />
              ))}
            </DiscoveryRail>
          ))}

          {!props.loading && !props.error && sections.length === 0 ? (
            <div className="rounded-[28px] border border-white/8 bg-white/[0.04] px-6 py-10 text-center">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-white/44">No titles to show</div>
              <p className="mt-3 text-sm text-white/55">
                {props.query.trim()
                  ? "Nothing surfaced for the active query and filter stack. Loosen the stack or reset it."
                  : "The current filter stack is too narrow. Open filters and loosen a few constraints."}
              </p>
            </div>
          ) : null}

          {props.feed?.continueCursor ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={props.onLoadMore}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72 transition-colors hover:bg-white/[0.08]"
              >
                <LoaderCircle className={clsx("h-4 w-4", props.loading && "animate-spin")} />
                Load More Titles
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <ExploreFilterModal
        open={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        feed={props.feed}
        filters={filters}
        activeFilterCount={activeFilterCount}
        genreFacetQuery={genreFacetQuery}
        onGenreFacetQueryChange={setGenreFacetQuery}
        onToggleProvider={props.onToggleProvider}
        onToggleMediaType={props.onToggleMediaType}
        onToggleGenre={props.onToggleGenre}
        onToggleSection={props.onToggleSection}
        onToggleAudio={props.onToggleAudio}
        onChangeVaultFilter={props.onChangeVaultFilter}
        onChangeAvailability={props.onChangeAvailability}
        onChangeYearMin={props.onChangeYearMin}
        onChangeYearMax={props.onChangeYearMax}
        onChangePersonQuery={props.onChangePersonQuery}
        onChangePersonRole={props.onChangePersonRole}
        onSetFilters={props.onSetFilters}
        onResetFilters={props.onResetFilters}
        animeMode={animeMode}
        onChangeAnimeMode={setAnimeMode}
        sortMode={sortMode}
        onChangeSortMode={setSortMode}
      />

      <ExploreItemModal item={selectedItem} onClose={() => setSelectedItem(null)} onImport={props.onImport} onOpenVault={props.onOpenVault} />
    </>
  );
}
