import { ChevronDown, Download, Film, Info, Library, Play, Plus, Search, UserRound } from "lucide-react";
import { clsx } from "clsx";
import type { CommandSearchResult } from "../lib/command-search";
import { ProviderIcon } from "./ProviderIcon";
import { balancedBackgroundImage } from "../lib/image-resolution";

type CommandResultRowProps = {
  result: CommandSearchResult;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onAdd: () => void;
  onMore: () => void;
};

function ResultThumb({ result }: { result: CommandSearchResult }) {
  if (result.kind === "person") {
    return (
      <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-md bg-white/8 text-white/55">
        <UserRound className="h-5 w-5" />
      </div>
    );
  }

  if (result.kind === "remote-title") {
    return (
      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-white/8">
        {result.posterUrl ? (
          <div className="absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(result.posterUrl, "poster-thumb")} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ProviderIcon provider={result.provider} className="h-7 w-7" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-white/8">
      {result.posterUrl ? (
        <div className="absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(result.posterUrl, "poster-thumb")} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Film className="h-5 w-5 text-white/35" />
        </div>
      )}
    </div>
  );
}

function resultTitle(result: CommandSearchResult) {
  return result.kind === "person" ? result.name : result.title;
}

function resultDescription(result: CommandSearchResult) {
  if (result.kind === "person") {
    return result.knownFor.length > 0 ? `Known for ${result.knownFor.slice(0, 3).join(", ")}` : "Search titles connected to this person.";
  }
  return result.description || "No synopsis available yet.";
}

function ResultSourceIcons({ result }: { result: CommandSearchResult }) {
  if (result.kind !== "remote-title") {
    return null;
  }

  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {result.sourceMatches.slice(0, 4).map((source) => (
        <ProviderIcon
          key={`${source.provider}:${source.importSlug}`}
          provider={source.provider}
          className="h-5 w-5 border border-[#080a0f]"
        />
      ))}
    </span>
  );
}

function availabilityLabel(result: CommandSearchResult) {
  if (result.kind !== "remote-title") {
    return null;
  }
  if (result.availability === "checking") return "Checking";
  if (result.availability === "available") return "Available";
  if (result.availability === "unavailable") return "Not on VidKing";
  if (result.availability === "unknown") return "Availability unknown";
  return null;
}

function availabilityClass(result: CommandSearchResult) {
  if (result.kind !== "remote-title") return "";
  if (result.availability === "available") return "bg-emerald-400/12 text-emerald-200";
  if (result.availability === "unavailable") return "bg-red-400/12 text-red-200";
  if (result.availability === "unknown") return "bg-amber-400/12 text-amber-100";
  return "bg-white/8 text-white/42";
}

export function CommandResultRow({
  result,
  expanded,
  busy,
  onToggle,
  onPlay,
  onAdd,
  onMore,
}: CommandResultRowProps) {
  const isTitle = result.kind !== "person";
  const saved = isTitle && result.kind === "local-title" ? true : result.kind === "remote-title" && result.saved;
  const downloadedCount = isTitle ? result.downloadedCount : 0;
  const canPlay = result.kind === "local-title" || (result.kind === "remote-title" && result.saved);
  const canAdd = result.kind === "remote-title" && !result.saved && !result.sourceMatches.every((source) => source.availability === "unavailable");
  const statusLabel = availabilityLabel(result);

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-xl border transition-colors",
        expanded ? "border-white/10 bg-white/[0.055]" : "border-transparent bg-transparent hover:bg-white/[0.035]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-3 text-left"
      >
        <ResultThumb result={result} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-white">{resultTitle(result)}</span>
            <ResultSourceIcons result={result} />
            {saved ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70" title="Saved">
                <Library className="h-3 w-3" />
              </span>
            ) : null}
            {downloadedCount > 0 ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-emerald-400/12 px-1.5 text-[10px] font-bold text-emerald-200" title="Downloaded">
                <Download className="h-3 w-3" />
                {downloadedCount}
              </span>
            ) : null}
            {statusLabel ? (
              <span className={clsx("inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-bold", availabilityClass(result))}>
                {statusLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-1 line-clamp-1 text-[12px] font-medium text-white/38">{result.subtitle}</div>
          {expanded ? (
            <p className="mt-4 line-clamp-2 max-w-2xl text-[13px] leading-5 text-white/52">{resultDescription(result)}</p>
          ) : null}
        </div>
        <ChevronDown className={clsx("mt-5 h-4 w-4 shrink-0 text-white/35 transition-transform", expanded ? "rotate-180" : "")} />
      </button>

      {expanded ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pl-[4.25rem]">
          {isTitle ? (
            <button
              type="button"
              onClick={onPlay}
              disabled={!canPlay || busy}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play className="h-4 w-4 fill-black" strokeWidth={0} />
              Play
            </button>
          ) : (
            <button
              type="button"
              onClick={onMore}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black transition hover:bg-white/90"
            >
              <Search className="h-4 w-4" />
              Search
            </button>
          )}

          {canAdd ? (
            <button
              type="button"
              onClick={onAdd}
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white/12 px-4 text-sm font-bold text-white transition hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          ) : saved && result.kind === "remote-title" ? (
            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-bold text-white/58">
              <Library className="h-4 w-4" />
              Saved
            </span>
          ) : result.kind === "remote-title" && !result.saved ? (
            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-red-400/10 px-4 text-sm font-bold text-red-100/70">
              Not available
            </span>
          ) : null}

          {isTitle ? (
            <button
              type="button"
              onClick={onMore}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-bold text-white/76 transition hover:bg-white/16"
            >
              <Info className="h-4 w-4" />
              More
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
