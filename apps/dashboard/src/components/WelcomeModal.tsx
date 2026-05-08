import { ArrowRight, CheckCircle2, FolderOpen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type WelcomeModalProps = {
  vaultConnected: boolean;
  connectedFolderName?: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onConnectVault: () => Promise<void>;
};

type CoachTarget = {
  id: string;
  selector: string;
  title: string;
  body: string;
  side?: "bottom" | "right";
};

type RectLike = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const SEARCH_IMPORT_TARGETS: CoachTarget[] = [
  {
    id: "search",
    selector: '[data-tutorial="search-bar"]',
    title: "Search here",
    body: "Search imported titles, try a movie name, or explore something new from this bar.",
    side: "bottom",
  },
  {
    id: "import",
    selector: '[data-tutorial="sidebar-import"]',
    title: "Import Tool",
    body: "Open this when you want to add a movie or series into your library.",
    side: "right",
  },
];

const LIBRARY_TARGETS: CoachTarget[] = [
  {
    id: "favorites",
    selector: '[data-tutorial="sidebar-favorites"]',
    title: "Favorites",
    body: "Your saved picks live here.",
    side: "right",
  },
  {
    id: "downloaded",
    selector: '[data-tutorial="sidebar-downloaded"]',
    title: "Downloaded",
    body: "Open the titles you already saved locally.",
    side: "right",
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function useTutorialRects(selectors: string[]) {
  const [rects, setRects] = useState<Record<string, RectLike>>({});

  useEffect(() => {
    function readRects() {
      const next: Record<string, RectLike> = {};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }
        const rect = node.getBoundingClientRect();
        next[selector] = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      }
      setRects(next);
    }

    readRects();
    window.addEventListener("resize", readRects);
    window.addEventListener("scroll", readRects, true);
    return () => {
      window.removeEventListener("resize", readRects);
      window.removeEventListener("scroll", readRects, true);
    };
  }, [selectors]);

  return rects;
}

function HighlightRing({ rect }: { rect: RectLike }) {
  return (
    <div
      className="pointer-events-none fixed z-[171] rounded-[18px] border border-white/25 shadow-[0_0_0_9999px_rgba(0,0,0,0.34),0_0_0_2px_rgba(255,255,255,0.2),0_24px_80px_rgba(0,0,0,0.28)]"
      style={{
        top: rect.top - 8,
        left: rect.left - 8,
        width: rect.width + 16,
        height: rect.height + 16,
      }}
    />
  );
}

function CoachBubble({ rect, target }: { rect: RectLike; target: CoachTarget }) {
  const width = 260;
  const bubbleTop =
    target.side === "right"
      ? clamp(rect.top + rect.height / 2 - 58, 20, window.innerHeight - 140)
      : clamp(rect.top + rect.height + 20, 20, window.innerHeight - 160);
  const bubbleLeft =
    target.side === "right"
      ? clamp(rect.left + rect.width + 18, 16, window.innerWidth - width - 16)
      : clamp(rect.left, 16, window.innerWidth - width - 16);

  const lineStyle =
    target.side === "right"
      ? {
          top: rect.top + rect.height / 2,
          left: rect.left + rect.width + 4,
          width: Math.max(18, bubbleLeft - (rect.left + rect.width + 4)),
          height: 2,
        }
      : {
          top: rect.top + rect.height + 4,
          left: rect.left + Math.min(rect.width / 2, 48),
          width: 2,
          height: Math.max(18, bubbleTop - (rect.top + rect.height + 4)),
        };

  return (
    <>
      <div
        className="pointer-events-none fixed z-[172] rounded-full bg-white/55"
        style={lineStyle}
      />
      <div
        className="fixed z-[173] w-[260px] rounded-[20px] border border-white/10 bg-[#12161d]/96 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
        style={{ top: bubbleTop, left: bubbleLeft }}
      >
        <div className="mt-2 text-sm font-semibold text-white">{target.title}</div>
        <p className="mt-1 text-sm leading-6 text-white/55">{target.body}</p>
      </div>
    </>
  );
}

export function WelcomeModal({
  vaultConnected,
  connectedFolderName,
  onClose,
  onOpenSettings,
  onConnectVault,
}: WelcomeModalProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const selectors = useMemo(
    () => [...SEARCH_IMPORT_TARGETS, ...LIBRARY_TARGETS].map((target) => target.selector),
    [],
  );
  const rects = useTutorialRects(selectors);

  async function handleConnectVault() {
    setConnectBusy(true);
    try {
      await onConnectVault();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Folder connection failed.");
    } finally {
      setConnectBusy(false);
    }
  }

    if (stepIndex === 1 || stepIndex === 2) {
      const targets = stepIndex === 1 ? SEARCH_IMPORT_TARGETS : LIBRARY_TARGETS;

    return (
      <div className="fixed inset-0 z-[160] bg-black/18">
        <button
          onClick={onClose}
          className="fixed right-4 top-4 z-[174] flex h-11 w-11 items-center justify-center rounded-full bg-white/6 text-white/55 transition hover:bg-white/12 hover:text-white"
          aria-label="Close welcome popup"
        >
          <X className="h-5 w-5" />
        </button>

        {targets.map((target) => {
          const rect = rects[target.selector];
          if (!rect) {
            return null;
          }
          return (
            <div key={target.id}>
              <HighlightRing rect={rect} />
              <CoachBubble rect={rect} target={target} />
            </div>
          );
        })}

        <div className="fixed bottom-5 left-1/2 z-[174] w-[min(92vw,520px)] -translate-x-1/2 rounded-[24px] border border-white/10 bg-[#0d1016]/96 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)]">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-white/35">
            <span>{String(stepIndex + 1).padStart(2, "0")}</span>
            <span>/</span>
            <span>03</span>
          </div>

          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {stepIndex === 1 ? "Search and import" : "Browse your library"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/56">
            {stepIndex === 1
              ? "These are the real controls you will use to search and bring titles into Spilled."
              : "These are the main library sections you will use once titles are inside your collection."}
          </p>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setStepIndex(index)}
                  className={`relative h-2.5 rounded-full transition-all duration-300 ${index === stepIndex ? "w-8 bg-white/30" : "w-2.5 bg-white/20 hover:bg-white/35"}`}
                  aria-label={`Go to step ${index + 1}`}
                >
                  {index === stepIndex ? (
                    <>
                      <span className="absolute inset-0 animate-pulse rounded-full bg-white/35" />
                      <span className="absolute inset-[2px] rounded-full bg-white" />
                    </>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStepIndex((current) => current - 1)}
                className="rounded-full border border-white/12 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/72 transition hover:border-white/24 hover:bg-white/6 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (stepIndex === 2) {
                    onClose();
                    return;
                  }
                  setStepIndex((current) => current + 1);
                }}
                className="rounded-full border border-white/12 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/72 transition hover:border-white/24 hover:bg-white/6 hover:text-white"
              >
                {stepIndex === 2 ? "Continue" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/82 px-3 py-6 backdrop-blur-xl">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0d1016]/95 shadow-[0_40px_120px_rgba(0,0,0,0.72)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        <div className="absolute -left-12 top-8 h-40 w-40 rounded-full bg-orange-500/16 blur-3xl" />
        <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-cyan-500/12 blur-3xl" />

        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/6 text-white/55 transition hover:bg-white/12 hover:text-white"
          aria-label="Close welcome popup"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-white/78 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <FolderOpen className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-white/35">
                <span>01</span>
                <span>/</span>
                <span>03</span>
              </div>

              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
                Set up your vault
              </h2>

              <p className="mt-3 max-w-lg text-sm leading-7 text-white/58">
                Connect a local vault first so Spilled has a place to save downloads and episode data.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-white/10 bg-white/[0.045] p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.28em] text-white/38">Vault</div>
                <div className="mt-2 flex items-center gap-2 text-sm text-white">
                  <CheckCircle2 className={vaultConnected ? "h-4 w-4 text-emerald-300" : "h-4 w-4 text-white/30"} />
                  {vaultConnected ? `Connected to ${connectedFolderName ?? "your folder"}` : "No local vault connected yet"}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:items-end">
                <button
                  type="button"
                  onClick={() => void handleConnectVault()}
                  disabled={connectBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-black uppercase tracking-[0.22em] text-black transition hover:bg-orange-200 disabled:cursor-wait disabled:opacity-70"
                >
                  {connectBusy ? "Connecting..." : vaultConnected ? "Reconnect vault" : "Connect vault"}
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-xs text-white/45 transition hover:text-white/70"
                >
                  Open full settings
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setStepIndex(index)}
                  className={`relative h-2.5 rounded-full transition-all duration-300 ${index === stepIndex ? "w-8 bg-white/30" : "w-2.5 bg-white/20 hover:bg-white/35"}`}
                  aria-label={`Go to step ${index + 1}`}
                >
                  {index === stepIndex ? (
                    <>
                      <span className="absolute inset-0 animate-pulse rounded-full bg-white/35" />
                      <span className="absolute inset-[2px] rounded-full bg-white" />
                    </>
                  ) : null}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setStepIndex(1)}
              className="rounded-full border border-white/12 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/72 transition hover:border-white/24 hover:bg-white/6 hover:text-white"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
