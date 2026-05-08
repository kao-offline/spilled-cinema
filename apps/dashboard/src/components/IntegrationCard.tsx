import type { ReactNode } from "react";
import { CheckCircle2, Clapperboard, Database, Film, Frame, Search, Subtitles, type LucideIcon } from "lucide-react";
import { clsx } from "clsx";
import {
  INTEGRATION_CAPABILITY_LABELS,
  type IntegrationCapabilityKey,
  type IntegrationDefinition,
  type IntegrationStatus,
} from "../lib/integrations";

const capabilityIcons: Record<IntegrationCapabilityKey, LucideIcon> = {
  import: Database,
  remoteSearch: Search,
  streaming: Clapperboard,
  downloads: Film,
  subtitles: Subtitles,
};

const statusClasses: Record<IntegrationStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20",
  beta: "bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20",
  planned: "bg-white/10 text-white/60 ring-1 ring-white/10",
  unstable: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20",
};

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.24em]",
        statusClasses[status],
      )}
    >
      <CheckCircle2 className="h-3 w-3" />
      {status}
    </span>
  );
}

export function IntegrationCapabilityList({ integration }: { integration: IntegrationDefinition }) {
  const enabledCapabilities = (Object.entries(integration.capabilities) as Array<[IntegrationCapabilityKey, boolean]>)
    .filter(([, enabled]) => enabled);

  return (
    <div className="flex flex-wrap gap-2">
      {enabledCapabilities.map(([capability]) => {
        const Icon = capabilityIcons[capability];
        return (
          <span
            key={capability}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-semibold text-white/75"
          >
            <Icon className="h-3.5 w-3.5 text-white/45" />
            {INTEGRATION_CAPABILITY_LABELS[capability]}
          </span>
        );
      })}
    </div>
  );
}

export function IntegrationCard({
  integration,
  accent = "default",
  footer,
}: {
  integration: IntegrationDefinition;
  accent?: "default" | "dense" | "compact";
  footer?: ReactNode;
}) {
  return (
    <article
      className={clsx(
        "rounded-[28px] border border-white/8 bg-white/[0.045] text-left shadow-[0_20px_50px_rgba(0,0,0,0.28)] transition-colors hover:bg-white/[0.065]",
        accent === "compact" ? "space-y-3 p-5" : accent === "dense" ? "space-y-4 p-5" : "space-y-5 p-6",
      )}
    >
      <div className={clsx("flex items-start", accent === "compact" ? "gap-3" : "gap-4")}>
        <div
          className={clsx(
            "shrink-0 rounded-2xl border border-white/6 bg-[#131419] shadow-inner",
            accent === "compact" ? "flex h-12 w-12 items-center justify-center" : "flex h-14 w-14 items-center justify-center",
          )}
        >
          <Frame className={clsx(accent === "compact" ? "h-5 w-5" : "h-6 w-6", "text-white/40")} />
        </div>

        <div className={clsx("min-w-0 flex-1", accent === "compact" ? "space-y-2.5" : "space-y-3")}>
          <div className="flex flex-wrap items-center gap-2.5">
            <div>
              <h3 className={clsx(accent === "compact" ? "text-base" : "text-lg", "font-bold tracking-tight text-white")}>
                {integration.domain}
              </h3>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/30">{integration.copy.supportBadge}</p>
            </div>
            <IntegrationStatusBadge status={integration.status} />
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
              {integration.copy.shortLabel}
            </span>
          </div>

          <p className={clsx("max-w-2xl text-white/58", accent === "compact" ? "text-[13px] leading-6" : "text-sm leading-6")}>
            {integration.description}
          </p>
          <IntegrationCapabilityList integration={integration} />
        </div>
      </div>

      {integration.copy.notes ? (
        <div className={clsx(accent === "compact" ? "px-1 text-[13px]" : "rounded-2xl border border-white/6 bg-black/15 px-4 py-3 text-sm", "leading-6 text-white/55")}>
          {integration.copy.notes}
        </div>
      ) : null}

      {footer}
    </article>
  );
}
