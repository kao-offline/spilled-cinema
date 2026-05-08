import { Binary, ServerCog } from "lucide-react";
import { IntegrationCard } from "./IntegrationCard";
import { INTEGRATIONS } from "../lib/integrations";

export function SupportView() {
  return (
    <div className="mx-auto h-full w-full max-w-6xl animate-fade-in px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="space-y-4">
        <p className="text-xs font-black uppercase tracking-[0.35em] text-orange-300/80">Source Modules</p>
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Supported Integrations</h2>
          <p className="mt-3 text-base leading-7 text-white/45">
            Every extractor module is defined once and surfaced consistently across import, search, playback, and download-aware flows.
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(245,158,11,0.08))] p-5 text-sm leading-7 text-amber-100/90 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
        <div className="flex items-start gap-3">
          <ServerCog className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
          <p>
            Mobile browsers can keep local library data and cached metadata, but connected-folder access is still desktop-only. Full `ffmpeg`
            downloads can now fall back to `ffmpeg.wasm` in the browser, but stream resolution and proxying still need a relay/backend for
            hostile providers and HLS manifests.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        {INTEGRATIONS.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} accent="compact" />
        ))}
      </div>

      <div className="mt-8 rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-black/20">
            <Binary className="h-5 w-5 text-white/55" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold tracking-tight text-white">Integration model</h3>
            <p className="max-w-3xl text-sm leading-7 text-white/52">
              New providers should be added as extractor modules plus one registry definition. Once a source is registered, Support and Settings
              render it automatically without another one-off UI pass.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
