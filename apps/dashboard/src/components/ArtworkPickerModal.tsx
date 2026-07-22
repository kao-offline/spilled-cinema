import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  RectangleHorizontal,
  RefreshCw,
  ScanLine,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { ArtworkSourceSettings, ImportedShow } from "../lib/types";
import { searchArtworkAssetsForShow, type ArtworkAsset } from "../lib/import-client";
import { balancedBackgroundImage } from "../lib/image-resolution";

type ArtworkTab = "logo" | "poster" | "banner" | "wlogo-banner";
type ArtworkSourceFilter = "all" | ArtworkAsset["source"];
type ArtworkLanguageFilter = "all" | "en" | "cs-sk" | "other";

type ArtworkPickerModalProps = {
  show: ImportedShow | null;
  open: boolean;
  artworkSources: ArtworkSourceSettings;
  onClose: () => void;
  onApplyArtwork: (artwork: {
    posterUrl?: string | null;
    backdropUrl?: string | null;
    bannerUrl?: string | null;
    clearLogoUrl?: string | null;
    bannerWithLogoUrl?: string | null;
  }) => void;
};

const PAGE_SIZE = 24;

const artworkTabs = [
  { key: "poster", label: "Poster", icon: ImageIcon },
  { key: "banner", label: "Banner", icon: Images },
  { key: "logo", label: "HD Logo", icon: ScanLine },
  { key: "wlogo-banner", label: "WLogo Banner", icon: RectangleHorizontal },
] as const;

function currentArtworkUrl(show: ImportedShow, tab: ArtworkTab) {
  if (tab === "poster") return show.posterUrl ?? null;
  if (tab === "banner") return show.artwork?.bannerUrl ?? show.backdropUrl ?? show.bannerUrl ?? null;
  if (tab === "wlogo-banner") return show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null;
  return show.clearLogoUrl ?? null;
}

function previewClasses(tab: ArtworkTab) {
  if (tab === "poster") return "aspect-[2/3]";
  if (tab === "logo") return "aspect-[2.8/1]";
  return "aspect-video";
}

function previewFit(tab: ArtworkTab) {
  return tab === "logo" || tab === "wlogo-banner" ? "bg-contain" : "bg-cover";
}

function artworkLanguageGroup(language: string | null | undefined): Exclude<ArtworkLanguageFilter, "all"> {
  const normalized = language?.trim().toLowerCase();
  if (normalized === "en" || normalized === "eng") return "en";
  if (["cs", "ces", "cz", "sk", "slk"].includes(normalized ?? "")) return "cs-sk";
  return "other";
}

export function ArtworkPickerModal({ show, open, artworkSources, onClose, onApplyArtwork }: ArtworkPickerModalProps) {
  const [artworkTab, setArtworkTab] = useState<ArtworkTab>("poster");
  const [artworkSourceFilter, setArtworkSourceFilter] = useState<ArtworkSourceFilter>("all");
  const [artworkLanguageFilter, setArtworkLanguageFilter] = useState<ArtworkLanguageFilter>("all");
  const [artworkAssets, setArtworkAssets] = useState<ArtworkAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<ArtworkAsset | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [requestVersion, setRequestVersion] = useState(0);
  const [artworkLoading, setArtworkLoading] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [appliedSelection, setAppliedSelection] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setAppliedSelection(null);
    setArtworkTab(show?.posterUrl || !show?.clearLogoUrl ? "poster" : "logo");
    setArtworkSourceFilter("all");
    setArtworkLanguageFilter("all");
    setArtworkAssets([]);
    setSelectedAsset(null);
    setVisibleCount(PAGE_SIZE);
    setArtworkError(null);
  }, [open, show?.slug]);

  useEffect(() => {
    if (!show || !open) return;
    let canceled = false;
    setArtworkLoading(true);
    setArtworkError(null);

    void searchArtworkAssetsForShow(show, artworkSources)
      .then((assets) => {
        if (!canceled) setArtworkAssets(assets);
      })
      .catch((error) => {
        if (!canceled) setArtworkError(error instanceof Error ? error.message : "Failed to load artwork.");
      })
      .finally(() => {
        if (!canceled) setArtworkLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [artworkSources.fanart, artworkSources.tmdb, artworkSources.tvdb, open, requestVersion, show?.slug]);

  const filteredArtworkAssets = useMemo(() => artworkAssets.filter((asset) => {
    if (asset.kind !== artworkTab) return false;
    if (artworkSourceFilter !== "all" && asset.source !== artworkSourceFilter) return false;
    return artworkLanguageFilter === "all" || artworkLanguageGroup(asset.language) === artworkLanguageFilter;
  }), [artworkAssets, artworkLanguageFilter, artworkSourceFilter, artworkTab]);

  const sourceCounts = useMemo(() => {
    const matching = artworkAssets.filter((asset) => asset.kind === artworkTab);
    return {
      all: matching.length,
      current: matching.filter((asset) => asset.source === "current").length,
      tmdb: matching.filter((asset) => asset.source === "tmdb").length,
      fanart: matching.filter((asset) => asset.source === "fanart").length,
      tvdb: matching.filter((asset) => asset.source === "tvdb").length,
    };
  }, [artworkAssets, artworkTab]);

  const languageCounts = useMemo(() => {
    const matching = artworkAssets.filter((asset) => asset.kind === artworkTab && (artworkSourceFilter === "all" || asset.source === artworkSourceFilter));
    return {
      all: matching.length,
      en: matching.filter((asset) => artworkLanguageGroup(asset.language) === "en").length,
      "cs-sk": matching.filter((asset) => artworkLanguageGroup(asset.language) === "cs-sk").length,
      other: matching.filter((asset) => artworkLanguageGroup(asset.language) === "other").length,
    };
  }, [artworkAssets, artworkSourceFilter, artworkTab]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedAsset(null);
  }, [artworkLanguageFilter, artworkSourceFilter, artworkTab]);

  useEffect(() => {
    setArtworkLanguageFilter("all");
  }, [artworkTab]);

  useEffect(() => {
    if (selectedAsset || artworkLoading || !show) return;
    const currentUrl = currentArtworkUrl(show, artworkTab);
    setSelectedAsset(
      filteredArtworkAssets.find((asset) => asset.url === currentUrl) ?? filteredArtworkAssets[0] ?? null,
    );
  }, [artworkLoading, artworkTab, filteredArtworkAssets, selectedAsset, show]);

  if (!open || !show) return null;

  const visibleAssets = filteredArtworkAssets.slice(0, visibleCount);
  const heroArtwork = show.artwork?.bannerUrl ?? show.backdropUrl ?? show.bannerUrl ?? show.posterUrl ?? null;

  const applySelection = () => {
    if (!selectedAsset) return;
    onApplyArtwork({
      posterUrl: artworkTab === "poster" ? selectedAsset.url : show.posterUrl ?? null,
      backdropUrl: artworkTab === "banner" ? selectedAsset.url : show.backdropUrl ?? null,
      bannerUrl: artworkTab === "banner" ? selectedAsset.url : show.artwork?.bannerUrl ?? show.backdropUrl ?? show.bannerUrl ?? null,
      clearLogoUrl: artworkTab === "logo" ? selectedAsset.url : show.clearLogoUrl ?? null,
      bannerWithLogoUrl: artworkTab === "wlogo-banner" ? selectedAsset.url : show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
    });
    setAppliedSelection(`${artworkTab}:${selectedAsset.url}`);
  };

  return createPortal(
    <div className="fixed inset-0 z-[150] h-[100dvh] overflow-hidden bg-[#030407]/88 backdrop-blur-xl" onMouseDown={onClose}>
      <div className="mx-auto box-border flex h-full min-h-0 w-full items-center justify-center p-1.5 sm:p-4 lg:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <section
          className="relative flex h-[calc(100dvh-0.75rem)] min-h-0 w-full max-w-[1480px] flex-col overflow-hidden rounded-[1.25rem] border border-white/[0.09] bg-[#08090d] shadow-[0_45px_160px_rgba(0,0,0,0.8)] sm:h-[calc(100dvh-2rem)] sm:max-h-[920px] sm:rounded-[2rem] lg:h-[calc(100dvh-3rem)]"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit artwork for ${show.title}`}
        >
          <header className="custom-scrollbar relative max-h-[min(38dvh,18rem)] shrink-0 overflow-y-auto overflow-x-hidden border-b border-white/[0.07] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-7 sm:pb-5 sm:pt-6">
            {heroArtwork ? (
              <div className="absolute inset-0 scale-105 bg-cover bg-center opacity-25 blur-sm" style={balancedBackgroundImage(heroArtwork, "backdrop-thumb")} />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,9,13,0.98)_0%,rgba(8,9,13,0.82)_50%,rgba(8,9,13,0.95)_100%)]" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <div className="hidden h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5 shadow-2xl ring-1 ring-white/10 sm:block">
                  {show.posterUrl ? <img src={show.posterUrl} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0">
                  <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-white/42">
                    <img src="/spilled-star.svg" alt="" className="h-3 w-3" /> Artwork studio
                  </div>
                  <h2 className="truncate text-xl font-black tracking-[-0.03em] text-white sm:text-3xl">{show.title}</h2>
                  <p className="mt-1 text-xs font-medium text-white/48 sm:text-sm">Choose the image that should define this title across your library.</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/30 text-white/65 ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/10 hover:text-white" aria-label="Close artwork editor">
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="relative mt-5 flex gap-1 overflow-x-auto rounded-xl bg-black/25 p-1 ring-1 ring-white/[0.07] sm:w-fit" aria-label="Artwork type">
              {artworkTabs.map(({ key, label, icon: Icon }) => (
                <button key={key} type="button" onClick={() => setArtworkTab(key)} className={clsx("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition sm:px-4", artworkTab === key ? "bg-white text-black shadow-lg" : "text-white/48 hover:bg-white/[0.07] hover:text-white")}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </nav>
          </header>

          <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_22rem]">
            <main className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-4 sm:px-7 sm:py-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {(["all", "current", "tmdb", "fanart", "tvdb"] as const).map((source) => (
                    <button key={source} type="button" disabled={sourceCounts[source] === 0} onClick={() => setArtworkSourceFilter(source)} className={clsx("shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition", artworkSourceFilter === source ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.035] text-white/45 hover:border-white/25 hover:text-white", sourceCounts[source] === 0 && "cursor-not-allowed opacity-30")}>
                      {source} <span className="ml-1 opacity-55">{sourceCounts[source]}</span>
                    </button>
                  ))}
                </div>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">{artworkLoading ? "Searching sources" : `${filteredArtworkAssets.length} options`}</span>
              </div>

              {artworkTab === "wlogo-banner" ? (
                <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Artwork language">
                  {(["all", "en", "cs-sk", "other"] as const).map((language) => (
                    <button key={language} type="button" disabled={languageCounts[language] === 0} onClick={() => setArtworkLanguageFilter(language)} className={clsx("shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition", artworkLanguageFilter === language ? "bg-white/14 text-white ring-1 ring-white/20" : "bg-white/[0.035] text-white/38 hover:text-white/75", languageCounts[language] === 0 && "cursor-not-allowed opacity-25")}>
                      {language === "all" ? "All languages" : language === "en" ? "English" : language === "cs-sk" ? "Czech / Slovak" : "Other / untagged"} <span className="ml-1 opacity-45">{languageCounts[language]}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {artworkLoading ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.025] text-white/45">
                  <LoaderCircle className="mb-4 h-6 w-6 animate-spin" />
                  <span className="text-sm font-semibold">Finding the best artwork</span>
                  <span className="mt-1 text-xs text-white/28">Searching TMDB, Fanart and TVDB</span>
                </div>
              ) : artworkError ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-red-400/15 bg-red-400/[0.06] px-6 text-center">
                  <p className="max-w-md text-sm text-red-100/80">{artworkError}</p>
                  <button type="button" onClick={() => setRequestVersion((version) => version + 1)} className="mt-5 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-white/85"><RefreshCw className="h-4 w-4" /> Try again</button>
                </div>
              ) : visibleAssets.length === 0 ? (
                <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.025] px-6 text-center text-sm text-white/38">No {artworkTab} artwork was found for this source.</div>
              ) : (
                <>
                  <div className={clsx("grid gap-3", artworkTab === "poster" ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3")}>
                    {visibleAssets.map((asset) => {
                      const selected = selectedAsset?.url === asset.url && selectedAsset.kind === asset.kind;
                      return (
                        <button key={`${asset.kind}-${asset.source}-${asset.url}`} type="button" onClick={() => setSelectedAsset(asset)} className={clsx("group relative overflow-hidden rounded-xl border bg-[#101116] text-left transition duration-200", selected ? "border-white ring-2 ring-white/20" : "border-white/[0.08] hover:-translate-y-0.5 hover:border-white/25")} aria-pressed={selected}>
                          <div className={clsx("w-full bg-[#15171e] bg-center bg-no-repeat", previewClasses(artworkTab), previewFit(artworkTab))} style={balancedBackgroundImage(asset.url, artworkTab === "logo" ? "logo" : artworkTab === "poster" ? "poster-card" : "backdrop-thumb")} />
                          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2.5">
                            <div className="min-w-0">
                              <div className="truncate text-xs font-bold text-white/85">{asset.label}</div>
                              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.17em] text-white/32">{asset.language || "No text"}{asset.width ? ` · ${asset.width}px` : ""}</div>
                            </div>
                            {selected ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-black"><Check className="h-3.5 w-3.5" /></span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {visibleCount < filteredArtworkAssets.length ? (
                    <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="mt-5 w-full rounded-xl border border-white/10 bg-white/[0.035] py-3 text-xs font-bold text-white/62 transition hover:bg-white/[0.07] hover:text-white">Show {Math.min(PAGE_SIZE, filteredArtworkAssets.length - visibleCount)} more</button>
                  ) : null}
                </>
              )}
            </main>

            <aside className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-white/[0.07] bg-[#0b0c10] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 lg:border-l lg:border-t-0 lg:p-6">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="custom-scrollbar hidden min-h-0 flex-1 overflow-y-auto pr-1 lg:block">
                  <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/32">Selected {artworkTab}</div>
                  <div className={clsx("mt-3 flex w-full items-center justify-center overflow-hidden rounded-xl bg-[#14161d] bg-center bg-no-repeat ring-1 ring-white/[0.08]", previewClasses(artworkTab), previewFit(artworkTab))} style={selectedAsset ? balancedBackgroundImage(selectedAsset.url, artworkTab === "logo" ? "logo" : artworkTab === "poster" ? "poster-card" : "backdrop-thumb") : undefined}>
                    {!selectedAsset ? <ImageIcon className="h-7 w-7 text-white/15" /> : null}
                  </div>
                  <div className="mt-4 min-h-12">
                    <div className="truncate text-sm font-bold text-white/85">{selectedAsset?.label ?? "Select an option"}</div>
                    {selectedAsset ? <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/32">{selectedAsset.source}{selectedAsset.language ? ` · ${selectedAsset.language}` : ""}</div> : null}
                  </div>
                </div>
                <button type="button" disabled={!selectedAsset || artworkLoading} onClick={applySelection} className="mt-auto flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black shadow-[0_14px_35px_rgba(0,0,0,0.35)] transition hover:bg-white/88 disabled:cursor-not-allowed disabled:opacity-35 lg:mt-4"><Check className="h-4 w-4" /> {selectedAsset && appliedSelection === `${artworkTab}:${selectedAsset.url}` ? "Applied — keep choosing" : `Apply ${artworkTab}`}</button>
                <p className="mt-3 hidden text-center text-[10px] leading-relaxed text-white/28 lg:block">Only this artwork slot will change. Your other title images stay untouched.</p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
