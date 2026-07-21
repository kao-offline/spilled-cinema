import { getProviderLabel } from "../lib/command-search";
import type { IntegrationId } from "../lib/integrations";

const PROVIDER_ICON_SRC: Partial<Record<IntegrationId, string>> = {
  bombuj: "/bombuj.png",
  svetserialu: "/svetserialu.png",
  vidking: "/vidking.png",
};

type ProviderIconProps = {
  provider: IntegrationId | string;
  className?: string;
};

export function ProviderIcon({ provider, className = "h-8 w-8" }: ProviderIconProps) {
  const src = PROVIDER_ICON_SRC[provider as IntegrationId];
  const label = provider === "cineby" ? "Cineby" : getProviderLabel(provider as IntegrationId);

  if (src) {
    return (
      <img
        src={src}
        alt={`${label} icon`}
        className={`${className} rounded-lg object-cover`}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span className={`${className} flex items-center justify-center rounded-lg bg-white/10 text-[10px] font-bold uppercase text-white/70`}>
      {label.slice(0, 2)}
    </span>
  );
}
