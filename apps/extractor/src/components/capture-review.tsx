"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Save, Zap, Film, Globe, Subtitles, Play, Layout } from "lucide-react";
import { bootstrapLibraryToken, createMediaItem } from "@/lib/library-storage";
import type { CaptureSession } from "@/lib/types";
import { choosePrimaryCandidate, hostnameFromUrl } from "@/lib/utils";

export function CaptureReview({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [tags, setTags] = useState("");
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    async function load() {
      try {
        const response = await fetch(`/api/capture/session/${sessionId}`);
        const payload = (await response.json()) as {
          session?: CaptureSession;
          error?: string;
        };

        if (!response.ok || !payload.session) {
          throw new Error(payload.error ?? "Capture session not found.");
        }

        const sess = payload.session;
        setSession(sess);

        if (sess.capturePayload) {
          setTitle((prev) => prev || sess.capturePayload?.pageTitle || "");
          setPosterUrl((prev) => prev || sess.capturePayload?.posterUrl || "");
        }

        if (sess.status === "pending") {
          timer = setTimeout(load, 2000);
        }

      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load capture session.");
      } finally {
        setLoading(false);
      }
    }

    void load();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  const primaryCandidate = useMemo(
    () =>
      session?.capturePayload
        ? choosePrimaryCandidate(session.capturePayload.mediaCandidates)
        : null,
    [session],
  );

  async function saveItem() {
    if (!session?.capturePayload || !primaryCandidate || !title.trim()) {
      return;
    }

    const libraryToken = await bootstrapLibraryToken();
    const item = await createMediaItem({
      libraryToken,
      title: title.trim(),
      sourcePageUrl: session.capturePayload.pageUrl,
      sourceHost: hostnameFromUrl(session.capturePayload.pageUrl),
      posterUrl: posterUrl || undefined,
      playback: {
        primaryUrl: primaryCandidate.url,
        kind: primaryCandidate.kind === "unknown" ? "direct_mp4" : primaryCandidate.kind,
        subtitleTracks: session.capturePayload.subtitleTracks,
      },
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      durationSeconds: session.capturePayload.detectedDurationSeconds,
    });

    setSavedItemId(item.id);
    await fetch(`/api/capture/session/${sessionId}`, {
      method: "PATCH",
    });
  }

  if (loading) {
    return (
      <div className="glass-panel flex min-h-[400px] items-center justify-center rounded-[40px] border-white/5">
        <LoaderCircle className="h-10 w-10 animate-spin text-[#00f2ff]" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="glass-panel rounded-[40px] border-red-500/20 p-12 text-center max-w-2xl mx-auto">
        <div className="flex flex-col items-center gap-6">
          <div className="bg-red-500/10 p-4 rounded-full">
            <AlertTriangle className="h-10 w-10 text-red-400" />
          </div>
          <div className="space-y-2">
             <h2 className="text-2xl font-black text-white">Oops! Capture Failed</h2>
             <p className="text-red-200/60 leading-relaxed font-medium">{error ?? "Capture session not found."}</p>
          </div>
          <Link href="/import" className="btn-primary rounded-full px-8 py-4 text-sm">
             Try Another URL
          </Link>
        </div>
      </div>
    );
  }

  if (session.status === "pending") {
    return (
      <div className="glass-panel relative flex min-h-[400px] flex-col items-center justify-center gap-8 rounded-[40px] border-white/5 p-12 overflow-hidden max-w-4xl mx-auto">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 bg-[#00f2ff]/5 blur-[80px] rounded-full pointer-events-none" />
        <LoaderCircle className="relative h-12 w-12 animate-spin text-[#00f2ff]" />
        <div className="relative text-center space-y-4 max-w-sm">
          <h2 className="text-3xl font-black tracking-tight text-white">Capture in Progress</h2>
          <p className="text-muted leading-relaxed font-medium">
            The engine is waiting for data. Open the source page, run the extension, and click the player area to continue.
          </p>
          <div className="pt-4">
            <a
              href={session.sourcePageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-bold text-[#00f2ff] transition hover:bg-white/10"
            >
              Open Source Page
              <Zap className="h-4 w-4 fill-current" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!session.capturePayload || !primaryCandidate || session.status === "failed") {
    return (
      <div className="glass-panel space-y-6 rounded-[40px] border-red-500/20 p-12 max-w-2xl mx-auto text-center">
        <div className="flex flex-col items-center gap-6">
          <div className="bg-red-500/10 p-4 rounded-full">
            <AlertTriangle className="h-10 w-10 text-red-400" />
          </div>
          <div className="space-y-3">
             <h2 className="text-2xl font-black text-white">Extraction Blocked</h2>
             <p className="text-white/40 leading-relaxed max-w-sm font-medium">
               {session.lastError ?? "The player could not be safely extracted from the source page."}
             </p>
          </div>
          <div className="text-sm text-white/30 px-6 py-4 bg-black/20 rounded-2xl leading-relaxed">
             This site might use protected streams, blob URLs, or iframe sandbox restrictions that prevent internal isolation.
          </div>
          <Link href="/import" className="btn-primary rounded-full px-8 py-4 text-sm">
            Try Another Page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] max-w-7xl mx-auto pb-20">
      <section className="glass-panel relative overflow-hidden rounded-[40px] border-white/5 p-10 sm:p-12">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#00f2ff]/5 blur-[80px] pointer-events-none" />
        
        <div className="relative space-y-10">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-[#00f2ff]/20 bg-[#00f2ff]/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-[#00f2ff]">
              Review Stage
            </div>
            <h1 className="text-gradient text-4xl font-black tracking-tight leading-[1.1]">
              Media Isolated Successfully.
            </h1>
          </div>

          <div className="relative group aspect-video w-full overflow-hidden rounded-[28px] border border-white/5 bg-black shadow-2xl">
            {posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterUrl}
                alt={title || "Captured poster"}
                className="h-full w-full object-cover grayscale-[30%] group-hover:grayscale-0 transition-all duration-700 hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1a1f35] to-[#07080d]">
                <Film className="h-16 w-16 text-white/10" strokeWidth={1} />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <div className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">
                 <Globe className="h-3.5 w-3.5" />
                 Source Stream
              </div>
              <div className="break-all font-mono text-[11px] leading-relaxed text-white/80 selection:bg-[#00f2ff]/20">
                {primaryCandidate.url}
              </div>
            </div>
            
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-6 backdrop-blur-md">
              <div className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">
                 <Subtitles className="h-3.5 w-3.5" />
                 Attachments
              </div>
              <div className="text-sm font-bold text-white/90">
                {session.capturePayload.subtitleTracks.length > 0
                  ? `${session.capturePayload.subtitleTracks.length} Transcripts Found`
                  : "No Metadata Tracks"}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/5 p-6 backdrop-blur-md sm:col-span-2">
              <div className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">
                 <Layout className="h-3.5 w-3.5" />
                 Isolation Environment
              </div>
              <div className="flex items-center gap-3 text-sm font-bold text-[#00f2ff]">
                <div className="h-1.5 w-1.5 rounded-full bg-[#00f2ff] animate-pulse" />
                {primaryCandidate.kind === "embed"
                  ? "EMBEDDED PROVIDER IFRAME"
                  : primaryCandidate.kind === "hls"
                    ? "DIRECT HLS RECONSTRUCTION"
                    : "INTERNAL HTML5 PLAYER"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel relative rounded-[40px] border-white/5 p-10 sm:p-12">
        <div className="space-y-10">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
              Commit Logic
            </div>
            <h2 className="text-3xl font-black tracking-tight text-white">Save Capture.</h2>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#00f2ff]/60">Title Identity</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-medium transition-all focus:border-[#00f2ff]/40 focus:ring-0"
              />
            </div>
            
            <div className="space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#00f2ff]/60">Poster Artwork URL</label>
              <input
                value={posterUrl}
                onChange={(event) => setPosterUrl(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-medium transition-all focus:border-[#00f2ff]/40 focus:ring-0"
              />
            </div>
            
            <div className="space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#00f2ff]/60">Categorization Tags</label>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="genre, language, series..."
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-medium transition-all focus:border-[#00f2ff]/40 focus:ring-0"
              />
            </div>
          </div>

          <div className="pt-4">
            <button
              type="button"
              disabled={!title.trim() || savedItemId !== null}
              onClick={saveItem}
              className="btn-primary w-full flex items-center justify-center gap-3 rounded-full px-10 py-5 text-base font-black disabled:cursor-not-allowed disabled:opacity-50 transition-all hover:scale-102 active:scale-98 shadow-xl"
            >
              {savedItemId ? <CheckCircle2 className="h-6 w-6" /> : <Save className="h-6 w-6" />}
              {savedItemId ? "SAVED TO VAULT" : "SAVE TO LIBRARY"}
            </button>
          </div>

          {savedItemId ? (
            <div className="rounded-[32px] border border-[#00f2ff]/20 bg-[#00f2ff]/5 p-8 text-center space-y-4 shadow-inner">
               <h4 className="text-lg font-bold text-white tracking-tight">Capture Complete.</h4>
               <p className="text-xs text-white/50 leading-relaxed">
                  The media is now indexed in your local library with optimized playback configurations.
               </p>
               <div className="flex gap-4 pt-3">
                 <Link href={`/watch/${savedItemId}`} className="btn-primary flex-1 flex items-center justify-center gap-2 rounded-full py-4 text-xs font-black shadow-none ring-1 ring-white/10 hover:ring-white/20">
                    <Play className="h-4 w-4 fill-current" />
                    WATCH NOW
                 </Link>
                 <Link href="/" className="flex-1 flex items-center justify-center gap-2 rounded-full bg-white/5 py-4 text-xs font-black text-white/80 hover:bg-white/10 border border-white/5 transition-all">
                    LIBRARY
                 </Link>
               </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

