"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bookmark, LoaderCircle, Puzzle, Send, Zap, ChevronRight } from "lucide-react";
import { bootstrapLibraryToken, getLibraryToken } from "@/lib/library-storage";
import { isHttpUrl } from "@/lib/utils";

type SessionResponse = {
  sessionId: string;
  reviewUrl: string;
  iframeReviewUrl: string;
  bookmarkletHref: string;
  sourcePageUrl: string;
  installSteps: string[];
};

export function ImportShell() {
  const [pageUrl, setPageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bootstrapLibraryToken();
  }, []);

  const urlIsValid = useMemo(() => isHttpUrl(pageUrl), [pageUrl]);

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!urlIsValid) {
      setError("Paste a full http:// or https:// page URL.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = getLibraryToken();
      const response = await fetch("/api/capture/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourcePageUrl: pageUrl,
          libraryToken: token,
        }),
      });

      const payload = (await response.json()) as SessionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create capture session.");
      }

      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create capture session.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] max-w-7xl mx-auto pb-12">
      <section className="glass-panel relative overflow-hidden rounded-[40px] border-white/5 p-10 sm:p-14">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#00f2ff]/5 blur-[80px]" />
        
        <div className="relative z-10 space-y-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-[#00f2ff]/20 bg-[#00f2ff]/5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.25em] text-[#00f2ff]">
            <Zap className="h-3.5 w-3.5 fill-current" />
            Capture Engine
          </div>
          
          <h1 className="text-gradient text-5xl font-black tracking-tight leading-[1.1]">
            Isolate any player <br/> in seconds.
          </h1>
          
          <p className="text-lg leading-relaxed text-muted max-w-xl">
            Enter the source page URL below. SpilledCinema will prepare a clean environment to host the extracted media.
          </p>

          <form onSubmit={createSession} className="space-y-6 pt-4 max-w-xl">
            <div className="space-y-3">
              <label className="block text-xs font-bold uppercase tracking-widest text-[#00f2ff]/60">Source page URL</label>
              <input
                value={pageUrl}
                onChange={(event) => setPageUrl(event.target.value)}
                placeholder="https://example.com/watch/something"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-base transition-all focus:border-[#00f2ff]/40 focus:ring-0 backdrop-blur-md"
              />
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex items-center gap-3 rounded-full px-10 py-5 text-base font-bold disabled:cursor-not-allowed disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
            >
              {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              Initialize Session
            </button>
            
            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
                {error}
              </div>
            ) : null}
          </form>
        </div>
      </section>

      <section className="glass-panel relative rounded-[40px] border-white/5 p-10 overflow-hidden">
        {result ? (
          <div className="space-y-8 relative z-10">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00f2ff]">
                Session Prepared
              </div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white">Execute Capture</h2>
            </div>

            <div className="group rounded-[24px] border border-white/10 bg-white/5 p-6 transition-all hover:border-[#00f2ff]/30">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-3">Open source page</div>
              <a
                href={result.sourcePageUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 text-base text-white/90 group-hover:text-white"
              >
                <span className="truncate">{result.sourcePageUrl}</span>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-[#00f2ff]" />
              </a>
            </div>

            <div className="space-y-3">
              <Link
                href="/extension"
                className="flex w-full items-center justify-between gap-3 rounded-pull rounded-[24px] bg-[#00f2ff] px-8 py-5 text-sm font-black text-black shadow-xl transition-all hover:scale-[1.02] active:scale-98"
              >
                <div className="flex items-center gap-3">
                  <Puzzle className="h-5 w-5" />
                  USE BROWSER EXTENSION
                </div>
                <ChevronRight className="h-5 w-5" />
              </Link>
              
              <a
                href={result.bookmarkletHref}
                className="flex w-full items-center justify-between rounded-[24px] border border-white/10 bg-white/5 px-8 py-5 text-sm font-bold text-white/80 transition-all hover:bg-white/10 active:scale-98"
              >
                <div className="flex items-center gap-3">
                  <Bookmark className="h-5 w-5" />
                  DRAG BOOKMARKLET
                </div>
                <ChevronRight className="h-5 w-5" />
              </a>
              
              <Link
                href={result.reviewUrl}
                className="flex w-full items-center justify-between rounded-[24px] border border-white/10 px-8 py-5 text-sm font-bold text-white/60 hover:text-white hover:bg-white/5 transition-all"
              >
                OPEN REVIEW PAGE
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>

            <div className="rounded-2xl bg-black/40 p-6">
              <ol className="space-y-4 text-sm text-white/60">
                <li className="flex gap-4">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00f2ff]/10 text-[10px] font-black text-[#00f2ff]">
                    ID
                  </span>
                  <span className="font-mono text-white/80 selection:bg-[#00f2ff]/30">
                    {result.sessionId}
                  </span>
                </li>
                {result.installSteps.map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] font-black text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col justify-center space-y-6 text-center py-12">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-white/5">
              <Zap className="h-10 w-10 text-white/20" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-white">Awaiting URL</h2>
              <p className="text-muted max-w-xs mx-auto">
                Once initialized, this panel will provide the extraction tools for your session.
              </p>
            </div>
            <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
               <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full bg-white/5 blur-[60px]" />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

