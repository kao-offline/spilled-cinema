import { Download, Heart, Play, Plus } from "lucide-react";
import type { ImportedShow } from "../lib/types";
import { balancedBackgroundImage, balanceImageResolution } from "../lib/image-resolution";
import { getOverlayBannerArtwork, getTitleDescription, getTitleMetadataParts, type TitleMetadataFallback } from "../lib/media-library";

type HomeHeroProps = {
  featuredShow: ImportedShow | null;
  downloadedCount: number;
  onPlay: () => void;
  onAdd: () => void;
  onOpenSearch: () => void;
};

function getSubtitle(show: ImportedShow, fallback: TitleMetadataFallback | null) {
  const parts = getTitleMetadataParts(show, { fallback });
  return {
    rating: parts.find((part) => part.kind === "rating")?.label ?? null,
    parts: parts.filter((part) => part.kind !== "rating").map((part) => part.label),
    description: getTitleDescription(show, fallback),
  };
}

export function HomeHero({ featuredShow, downloadedCount, onPlay, onAdd, onOpenSearch }: HomeHeroProps) {
  if (!featuredShow) {
    return (
      <section className="relative flex min-h-[74vh] items-end overflow-hidden bg-[#05060a] px-5 pb-16 pt-28 sm:px-10 lg:min-h-[78vh] lg:px-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_35%,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,rgba(5,6,10,0.2),#05060a_82%)]" />
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-5xl font-black tracking-normal text-white sm:text-7xl">Spilled</h1>
          <p className="mt-4 max-w-xl text-base leading-6 text-white/62">
            Build your cinema vault from search. Add a title from your sources, then it becomes part of the homepage.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={onOpenSearch} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black">
              <Play className="h-4 w-4 fill-black" strokeWidth={0} />
              Search
            </button>
            <button onClick={onAdd} className="inline-flex h-11 items-center gap-2 rounded-full bg-white/12 px-5 text-sm font-bold text-white">
              <Plus className="h-4 w-4" />
              Add titles
            </button>
          </div>
        </div>
      </section>
    );
  }

  const subtitle = getSubtitle(featuredShow, null);
  const { bannerUrl: heroBackground, logoUrl } = getOverlayBannerArtwork(featuredShow);

  return (
    <section className="relative min-h-[78vh] overflow-hidden bg-[#05060a] px-5 pb-16 pt-28 sm:px-10 lg:min-h-[82vh] lg:px-16">
      <div key={`bg:${featuredShow.slug}`} className="absolute inset-0 animate-home-hero-bg">
        <div
          className="absolute inset-0 scale-[1.01] bg-cover bg-center"
          style={balancedBackgroundImage(heroBackground, "backdrop-hero")}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#05060a]/92 via-[#05060a]/50 to-[#05060a]/22" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05060a]/24 via-[#05060a]/6 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05060a] via-[#05060a]/14 to-[#05060a]/16" />
        <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#05060a] to-transparent" />
        <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#05060a] to-transparent" />
      </div>

      <div key={`copy:${featuredShow.slug}`} className="relative z-10 flex min-h-[calc(78vh-11rem)] max-w-[640px] animate-home-hero-copy flex-col justify-end lg:min-h-[calc(82vh-11rem)]">
        {logoUrl ? (
          <div className="mb-5 flex h-[clamp(88px,12vw,136px)] w-[min(62vw,520px)] items-end">
            <img
              src={balanceImageResolution(logoUrl, "logo") ?? logoUrl}
              alt={`${featuredShow.title} logo`}
              className="max-h-full w-auto max-w-full object-contain object-left-bottom drop-shadow-[0_18px_42px_rgba(0,0,0,0.64)]"
            />
          </div>
        ) : (
          <h1 className="mb-5 text-5xl font-black tracking-normal text-white drop-shadow-[0_18px_42px_rgba(0,0,0,0.58)] sm:text-7xl">
            {featuredShow.title}
          </h1>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[13px] font-black text-white/88 sm:text-[15px]">
          <span className="inline-flex items-center gap-1.5">
            <img src="/rating-icon.png" alt="" className="h-4 w-4 shrink-0" />
            {subtitle.rating ?? "Unrated"}
          </span>
          {subtitle.parts.map((part) => (
            <span key={part} className="inline-flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-white/34" />
              {part}
            </span>
          ))}
        </div>
        {subtitle.description ? (
          <p className="mt-3 line-clamp-2 max-w-[34rem] text-[13px] leading-5 text-white/68 sm:text-[14px]">{subtitle.description}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-black text-black transition hover:scale-[1.03]"
          >
            <Play className="h-4 w-4 fill-black" strokeWidth={0} />
            Play
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/14 text-white backdrop-blur transition hover:bg-white/22"
            aria-label="Open title"
          >
            <Heart className={`h-5 w-5 ${featuredShow.isFavorite ? "fill-white" : ""}`} />
          </button>
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-white/12 px-4 text-xs font-bold text-white/78 backdrop-blur">
            <Download className="h-4 w-4" />
            {downloadedCount > 0 ? `${downloadedCount} saved` : "Not downloaded"}
          </span>
        </div>
      </div>
    </section>
  );
}
