"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Frame,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import type { CaptureSession } from "@/lib/types";

export function IframeCaptureShell({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameSelected, setFrameSelected] = useState(false);

  function selectFrame() {
    setFrameSelected(true);
  }

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/capture/session/${sessionId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          session?: CaptureSession;
          error?: string;
        };

        if (response.ok && payload.session) {
          setSession(payload.session);
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="glass-panel rounded-[32px] border border-white/10 p-8 text-[var(--muted)]">
        Loading iframe capture...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="glass-panel rounded-[32px] border border-red-300/20 p-8 text-red-100">
        Capture session not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[32px] border border-white/10 p-8">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/20 bg-orange-300/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-orange-100/80">
            <Frame className="h-4 w-4" />
            In-app iframe capture
          </div>
          <h1 className="text-4xl font-semibold">Try the source page inside the app</h1>
          <p className="max-w-3xl text-lg leading-8 text-[var(--muted)]">
            This mode only works when the source site allows embedding. If the player is interactive inside the frame and the site is script-accessible, you can use it as a visual aid. For blocked sites, fall back to the bookmarklet.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/import"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-white/80 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
              New capture
            </Link>
            <a
              href={session.sourcePageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-white/80 hover:text-white"
            >
              <ExternalLink className="h-4 w-4" />
              Open source page
            </a>
            <Link
              href={`/capture/${sessionId}`}
              className="inline-flex items-center justify-center rounded-full bg-orange-500 px-5 py-3 text-sm font-medium text-white hover:bg-orange-400"
            >
              Open review screen
            </Link>
          </div>
        </div>
      </section>

      <section
        className={`glass-panel overflow-hidden rounded-[32px] border transition ${
          frameSelected
            ? "border-orange-300/50 shadow-[0_0_0_1px_rgba(253,186,116,0.35),0_24px_80px_rgba(0,0,0,0.42)]"
            : "border-white/10"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-6 py-4 text-sm">
          <div className="text-[var(--muted)]">Embedded source: {session.sourcePageUrl}</div>
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${
              frameSelected
                ? "bg-orange-400/15 text-orange-100"
                : "bg-white/8 text-white/60"
            }`}
          >
            {frameSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ScanSearch className="h-3.5 w-3.5" />}
            {frameSelected ? "Embedded source selected" : "Not selected"}
          </div>
        </div>
        <div className="relative h-[70vh] min-h-[520px] bg-black">
          <button
            type="button"
            aria-label="Select embedded source"
            onClick={selectFrame}
            className={`absolute inset-0 z-10 ${
              frameSelected ? "pointer-events-none" : ""
            }`}
          >
            <span className="sr-only">Select embedded source</span>
          </button>
          <iframe
            src={session.sourcePageUrl}
            title="Embedded capture source"
            className={`h-full w-full outline-none transition ${
              frameSelected ? "ring-4 ring-orange-300/40 ring-inset" : ""
            }`}
            allow="autoplay; fullscreen; picture-in-picture"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameLoaded(true)}
            onFocus={selectFrame}
          />
          {frameSelected ? (
            <div className="pointer-events-none absolute inset-0 z-20 border-4 border-orange-300/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
          ) : null}
          {!frameSelected && frameLoaded ? (
            <div className="pointer-events-none absolute inset-x-6 top-6 z-20 rounded-2xl border border-orange-300/25 bg-black/65 px-4 py-3 text-left text-sm text-orange-50 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
              Click the iframe area once to select it. The selected frame will highlight in orange.
            </div>
          ) : null}
          {!frameLoaded ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-[var(--muted)]">
              Loading embedded page...
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-6 py-4">
          <div className="max-w-2xl text-sm leading-7 text-[var(--muted)]">
            Click inside the iframe and then use the button below to mark it as your selected embedded source. This confirms the frame itself is the active target, even when the browser cannot expose the exact inner element.
          </div>
          <button
            type="button"
            onClick={selectFrame}
            className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 text-sm font-medium text-white hover:bg-orange-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            Select embedded source
          </button>
        </div>
      </section>

      <section className="glass-panel rounded-[32px] border border-white/10 p-8">
        <div className="flex items-start gap-3 text-sm leading-7 text-[var(--muted)]">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-orange-200" />
          <div>
            If this area stays blank, shows an error page, or only lets you select the frame shell instead of the exact inner player, the source site is blocking iframe embedding or cross-origin access. In those cases the bookmarklet is still the stronger extraction path.
          </div>
        </div>
      </section>
    </div>
  );
}
