import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import { clsx } from "clsx";
import type { ImportedShow } from "../lib/types";
import { searchArtworkAssetsForShow, type ArtworkAsset } from "../lib/import-client";

type ArtworkPickerModalProps = {
  show: ImportedShow | null;
  open: boolean;
  onClose: () => void;
  onApplyArtwork: (artwork: {
    posterUrl?: string | null;
    backdropUrl?: string | null;
    clearLogoUrl?: string | null;
  }) => void;
};

export function ArtworkPickerModal({ show, open, onClose, onApplyArtwork }: ArtworkPickerModalProps) {
  const [artworkTab, setArtworkTab] = useState<"logo" | "poster" | "backdrop">("logo");
  const [artworkSourceFilter, setArtworkSourceFilter] = useState<"all" | "tmdb" | "fanart" | "tvdb">("all");
  const [artworkAssets, setArtworkAssets] = useState<ArtworkAsset[]>([]);
  const [artworkLoading, setArtworkLoading] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setArtworkTab("logo");
    setArtworkSourceFilter("all");
    setArtworkAssets([]);
    setArtworkError(null);
  }, [open, show?.slug, show?.posterUrl, show?.backdropUrl, show?.clearLogoUrl]);

  useEffect(() => {
    if (!show || !open) {
      return;
    }

    let canceled = false;
    setArtworkLoading(true);
    setArtworkError(null);

    void searchArtworkAssetsForShow(show, {
      tmdb: true,
      fanart: true,
      tvdb: true,
    })
      .then((assets) => {
        if (!canceled) {
          setArtworkAssets(assets);
        }
      })
      .catch((error) => {
        if (!canceled) {
          setArtworkError(error instanceof Error ? error.message : "Failed to load artwork.");
        }
      })
      .finally(() => {
        if (!canceled) {
          setArtworkLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [open, show]);

  const filteredArtworkAssets = useMemo(() => {
    return artworkAssets.filter((asset) => {
      if (asset.kind !== artworkTab) {
        return false;
      }
      if (artworkSourceFilter !== "all" && asset.source !== artworkSourceFilter) {
        return false;
      }
      return true;
    });
  }, [artworkAssets, artworkSourceFilter, artworkTab]);

  if (!open || !show) {
    return null;
  }

  const activeCount = filteredArtworkAssets.length;

  return createPortal(
    <div
      className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-dvh w-full items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(20,22,30,0.98),rgba(13,14,20,0.98))] shadow-[0_40px_140px_rgba(0,0,0,0.55)] sm:max-h-[calc(100dvh-3rem)] lg:max-h-[calc(100dvh-4rem)]">
          <div className="border-b border-white/8 bg-white/[0.03] px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/35">
                  Artwork Editor
                </div>
                <div className="mt-1 text-base font-semibold text-white sm:text-lg">
                  {show.title}
                </div>
                <div className="mt-1 text-sm text-white/48">
                  Choose one clean asset and apply it directly.
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/65 transition hover:bg-white/10 hover:text-white"
                aria-label="Close artwork picker"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {([
                  { key: "logo", label: "HD Logo" },
                  { key: "poster", label: "Poster" },
                  { key: "backdrop", label: "Backdrop" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setArtworkTab(tab.key)}
                    className={clsx(
                      "rounded-full px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors sm:px-4",
                      artworkTab === tab.key
                        ? "bg-white text-[#111218]"
                        : "bg-white/6 text-white/55 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {(["all", "tmdb", "fanart", "tvdb"] as const).map((source) => (
                    <button
                      key={source}
                      onClick={() => setArtworkSourceFilter(source)}
                      className={clsx(
                        "rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors",
                        artworkSourceFilter === source
                          ? "border-orange-300/50 bg-orange-300/15 text-orange-100"
                          : "border-white/10 bg-white/5 text-white/45 hover:border-white/20 hover:text-white/75",
                      )}
                    >
                      {source === "all" ? "All" : source}
                    </button>
                  ))}
                </div>

                <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                  {artworkLoading ? "Loading" : `${activeCount} results`}
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            {artworkLoading ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-[1.5rem] border border-white/8 bg-black/20 text-white/45">
                <LoaderCircle className="mr-3 h-5 w-5 animate-spin" />
                Loading artwork...
              </div>
            ) : artworkError ? (
              <div className="rounded-[1.5rem] border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                {artworkError}
              </div>
            ) : activeCount === 0 ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-[1.5rem] border border-white/8 bg-black/20 px-6 text-center text-sm text-white/40">
                No assets found for this selection.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredArtworkAssets.map((asset) => (
                  <button
                    key={`${asset.kind}-${asset.source}-${asset.url}`}
                    onClick={() => {
                      onApplyArtwork({
                        posterUrl: artworkTab === "poster" ? asset.url : show.posterUrl ?? null,
                        backdropUrl: artworkTab === "backdrop" ? asset.url : show.backdropUrl ?? null,
                        clearLogoUrl: artworkTab === "logo" ? asset.url : show.clearLogoUrl ?? null,
                      });
                      onClose();
                    }}
                    className="group overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#0f1016] text-left transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#12141d]"
                  >
                    <div
                      className={clsx(
                        "w-full bg-[#171922] bg-center bg-no-repeat",
                        artworkTab === "logo"
                          ? "aspect-[2.8/1] bg-contain p-5"
                          : artworkTab === "poster"
                            ? "aspect-[2/3] bg-cover"
                            : "aspect-[16/9] bg-cover",
                      )}
                      style={{ backgroundImage: `url(${asset.url})` }}
                    />
                    <div className="flex items-center justify-between gap-3 border-t border-white/6 px-3.5 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{asset.label}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/36">
                          <span>{asset.source}</span>
                          {asset.language ? <span>{asset.language}</span> : null}
                          {asset.width ? <span>{asset.width}px</span> : null}
                        </div>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-black">
                        Use
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
