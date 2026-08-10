import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { ArtworkSourceSettings, ImportedShow } from "../lib/types";
import { searchArtworkAssetsForShow, type ArtworkAsset } from "../lib/import-client";
import { balancedBackgroundImage } from "../lib/image-resolution";

type ArtworkTab = "logo" | "poster" | "banner" | "wlogo-banner";

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

const PAGE_SIZE = 18;

const artworkTabs = [
  { key: "poster", label: "Poster" },
  { key: "banner", label: "Banner" },
  { key: "logo", label: "Logo" },
  { key: "wlogo-banner", label: "WLogo" },
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

export function ArtworkPickerModal({ show, open, artworkSources, onClose, onApplyArtwork }: ArtworkPickerModalProps) {
  const [artworkTab, setArtworkTab] = useState<ArtworkTab>("poster");
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

  const filteredArtworkAssets = useMemo(
    () => artworkAssets.filter((asset) => asset.kind === artworkTab),
    [artworkAssets, artworkTab],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedAsset(null);
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

  const applySelection = (event: React.MouseEvent) => {
    event.stopPropagation();
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
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 backdrop-blur-xl" onMouseDown={onClose}>
      <div
        className="glass-panel relative mx-4 flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/60 shadow-2xl"
        style={{ maxHeight: "85vh" }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit artwork for ${show.title}`}
      >
        <nav className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex gap-2">
            {artworkTabs.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setArtworkTab(key)} className={clsx("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition", artworkTab === key ? "bg-white text-black" : "text-white/50 hover:bg-white/10 hover:text-white")}>
                <span className={clsx("h-2 w-2 rounded-full", artworkTab === key ? "bg-red-500" : "bg-white/30")} />
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {artworkLoading ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <LoaderCircle className="mb-3 h-6 w-6 animate-spin text-white/50" />
              <span className="text-sm text-white/60">Finding artwork...</span>
            </div>
          ) : artworkError ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 px-6 text-center">
              <p className="text-sm text-red-200/80">{artworkError}</p>
              <button type="button" onClick={() => setRequestVersion((v) => v + 1)} className="mt-4 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20">
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </div>
          ) : visibleAssets.length === 0 ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm text-white/40">
              No artwork found for this type.
            </div>
          ) : (
            <>
              <div className={clsx("grid gap-3", artworkTab === "poster" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2")}>
                {visibleAssets.map((asset) => {
                  const selected = selectedAsset?.url === asset.url && selectedAsset.kind === asset.kind;
                  return (
                    <button key={`${asset.kind}-${asset.source}-${asset.url}`} type="button" onClick={() => setSelectedAsset(asset)} className={clsx("glass-card group relative overflow-hidden rounded-xl border transition", selected ? "border-white/40 ring-2 ring-white/20" : "border-white/10 hover:border-white/25")} aria-pressed={selected}>
                      <div className={clsx("w-full bg-white/5 bg-center bg-no-repeat", previewClasses(artworkTab), previewFit(artworkTab))} style={balancedBackgroundImage(asset.url, artworkTab === "logo" ? "logo" : artworkTab === "poster" ? "poster-card" : "backdrop-thumb")} />
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-white/80">{asset.label}</div>
                          <div className="text-[10px] text-white/40">{asset.source}</div>
                        </div>
                        {selected ? <Check className="h-4 w-4 text-white" /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
              {visibleCount < filteredArtworkAssets.length ? (
                <button type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)} className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-white/60 transition hover:bg-white/10 hover:text-white">
                  Show more ({filteredArtworkAssets.length - visibleCount} remaining)
                </button>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            {selectedAsset ? (
              <div className="truncate text-sm font-semibold text-white/80">{selectedAsset.label}</div>
            ) : (
              <div className="text-sm text-white/40">Select an artwork</div>
            )}
          </div>
          <button type="button" disabled={!selectedAsset || artworkLoading} onClick={applySelection} className="ml-4 flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30">
            <Check className="h-4 w-4" />
            {selectedAsset && appliedSelection === `${artworkTab}:${selectedAsset.url}` ? "Applied" : "Apply"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
