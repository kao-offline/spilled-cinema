import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, Play } from "lucide-react";
import type { ImportedShow } from "../lib/types";
import { getCachedHeroLogoAspect, preloadHeroImage } from "../lib/hero-assets";
import { balanceImageResolution, balancedBackgroundImage } from "../lib/image-resolution";
import { getOverlayBannerArtwork, getTitleDescription, getTitleMetadataParts } from "../lib/media-library";

type HeroProps = {
  featuredShow: ImportedShow | null;
  onPlay?: () => void;
  onToggleFavorite?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  progressKey?: string;
  progressDurationMs?: number;
};

type HeroSlideState = {
  show: ImportedShow;
  key: string;
};

function getWallpaper(show: ImportedShow | null) {
  return getOverlayBannerArtwork(show).bannerUrl;
}

function getLogoLayout(logoAspect: number) {
  if (logoAspect >= 3.25) {
    return {
      width: "min(34vw, 520px)",
      maxHeight: "min(30vh, 140px)",
      left: "clamp(18px, 1.8vw, 34px)",
      top: "clamp(24px, 4.5vw, 42px)",
    };
  }

  if (logoAspect >= 2.3) {
    return {
      width: "min(36vw, 560px)",
      maxHeight: "min(31vh, 152px)",
      left: "clamp(16px, 1.6vw, 30px)",
      top: "clamp(26px, 4.8vw, 46px)",
    };
  }

  return {
    width: "min(38vw, 600px)",
    maxHeight: "min(34vh, 180px)",
    left: "clamp(14px, 1.4vw, 26px)",
    top: "clamp(28px, 5vw, 50px)",
  };
}

function HeroArtworkLayer({
  wallpaper,
  opacityClass,
}: {
  wallpaper: string | null;
  opacityClass: string;
}) {
  return (
    <div className={`absolute inset-0 transition-opacity duration-700 ease-out ${opacityClass}`}>
      {wallpaper ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={balancedBackgroundImage(wallpaper, "backdrop-hero")}
          />
          <div
            className="absolute inset-0 scale-[1.03] bg-cover bg-center opacity-18 blur-2xl"
            style={balancedBackgroundImage(wallpaper, "backdrop-thumb")}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-[#131419]" />
      )}

      <div className="absolute inset-0 bg-gradient-to-r from-[#06070b]/90 via-[#090a0f]/58 via-38% to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/22 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f]/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_left_center,rgba(6,7,11,0.62),transparent_52%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_right_center,rgba(4,5,9,0.18),transparent_48%)]" />
      <div className="absolute inset-0 rounded-3xl ring-1 ring-white/6 ring-inset" />
    </div>
  );
}

export function Hero({
  featuredShow,
  onPlay,
  onToggleFavorite,
  onPrev,
  onNext,
  progressKey,
  progressDurationMs = 7000,
}: HeroProps) {
  const [scrollY, setScrollY] = useState(0);
  const [logoAspectByUrl, setLogoAspectByUrl] = useState<Record<string, number>>({});
  const [activeSlide, setActiveSlide] = useState<HeroSlideState | null>(
    featuredShow ? { show: featuredShow, key: `${featuredShow.slug}:initial` } : null,
  );
  const [outgoingSlide, setOutgoingSlide] = useState<HeroSlideState | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY || 0);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const clearLogoUrl = featuredShow?.clearLogoUrl;
    if (!clearLogoUrl) {
      return;
    }

    const cachedAspect = getCachedHeroLogoAspect(clearLogoUrl);
    if (cachedAspect) {
      setLogoAspectByUrl((current) => (current[clearLogoUrl] ? current : { ...current, [clearLogoUrl]: cachedAspect }));
      return;
    }

    let cancelled = false;
    void preloadHeroImage(clearLogoUrl)
      .then((image) => {
        if (cancelled || !image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
          return;
        }
        setLogoAspectByUrl((current) => ({
          ...current,
          [clearLogoUrl]: image.naturalWidth / image.naturalHeight,
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [featuredShow?.clearLogoUrl, logoAspectByUrl]);

  useEffect(() => {
    const urls = [featuredShow?.backdropUrl, featuredShow?.posterUrl, featuredShow?.clearLogoUrl].filter(
      (value): value is string => Boolean(value),
    );

    for (const url of urls) {
      void preloadHeroImage(url).catch(() => undefined);
    }
  }, [featuredShow?.backdropUrl, featuredShow?.clearLogoUrl, featuredShow?.posterUrl]);

  useEffect(() => {
    if (!featuredShow) {
      setActiveSlide(null);
      setOutgoingSlide(null);
      setIsTransitioning(false);
      return;
    }

    setActiveSlide((current) => {
      if (!current) {
        return { show: featuredShow, key: `${featuredShow.slug}:${Date.now()}` };
      }

      if (current.show.slug === featuredShow.slug) {
        return current.show === featuredShow ? current : { ...current, show: featuredShow };
      }

      setOutgoingSlide(current);
      setIsTransitioning(true);
      return { show: featuredShow, key: `${featuredShow.slug}:${Date.now()}` };
    });
  }, [featuredShow]);

  useEffect(() => {
    if (!isTransitioning) {
      return;
    }

    if (transitionTimeoutRef.current) {
      window.clearTimeout(transitionTimeoutRef.current);
    }

    transitionTimeoutRef.current = window.setTimeout(() => {
      setOutgoingSlide(null);
      setIsTransitioning(false);
      transitionTimeoutRef.current = null;
    }, 720);

    return () => {
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, [isTransitioning]);

  const currentShow = activeSlide?.show ?? featuredShow;
  const titleMetadata = getTitleMetadataParts(currentShow);
  const titleDescription = getTitleDescription(currentShow);
  const currentLogoAspect = currentShow?.clearLogoUrl ? (logoAspectByUrl[currentShow.clearLogoUrl] ?? 2.7) : 2.7;
  const currentLogoLayout = getLogoLayout(currentLogoAspect);
  const outgoingLogoAspect = outgoingSlide?.show.clearLogoUrl ? (logoAspectByUrl[outgoingSlide.show.clearLogoUrl] ?? 2.7) : 2.7;
  const outgoingLogoLayout = getLogoLayout(outgoingLogoAspect);
  const logoOffsetY = Math.min(scrollY * 0.12, 28);

  const activeWallpaper = useMemo(() => getWallpaper(currentShow ?? null), [currentShow]);
  const outgoingWallpaper = useMemo(() => getWallpaper(outgoingSlide?.show ?? null), [outgoingSlide]);

  if (!currentShow) {
    return (
      <div className="relative mb-8 mt-4 flex h-[280px] w-full items-center justify-center overflow-hidden rounded-3xl bg-white/5 px-4 sm:h-[340px] sm:px-6 lg:mx-10 lg:mt-6 lg:h-[400px]">
        <div className="text-sm font-medium text-white/30">No titles featured yet.</div>
      </div>
    );
  }

  return (
    <div className="relative mb-8 mt-2 w-full animate-fade-in px-4 sm:px-6 lg:mb-12 lg:px-10">
      <div className="relative h-[360px] w-full overflow-hidden rounded-3xl bg-[#131419] shadow-2xl sm:h-[420px] lg:h-[500px]">
        {outgoingSlide ? (
          <HeroArtworkLayer
            key={outgoingSlide.key}
            wallpaper={outgoingWallpaper}
            opacityClass={isTransitioning ? "opacity-0" : "opacity-100"}
          />
        ) : null}

        <HeroArtworkLayer
          key={activeSlide?.key ?? currentShow.slug}
          wallpaper={activeWallpaper}
          opacityClass={isTransitioning ? "opacity-100" : "opacity-100"}
        />

        {outgoingSlide?.show.clearLogoUrl ? (
          <div
            className={`pointer-events-none absolute hidden drop-shadow-[0_22px_40px_rgba(0,0,0,0.5)] transition-all duration-700 ease-out md:block ${isTransitioning ? "opacity-0 scale-[0.985] blur-[1px]" : "opacity-100 scale-100 blur-0"}`}
            style={{
              width: outgoingLogoLayout.width,
              maxHeight: outgoingLogoLayout.maxHeight,
              left: outgoingLogoLayout.left,
              top: outgoingLogoLayout.top,
              transform: `translate3d(0, ${logoOffsetY}px, 0)`,
            }}
          >
            <img
              src={balanceImageResolution(outgoingSlide.show.clearLogoUrl, "logo") ?? outgoingSlide.show.clearLogoUrl}
              alt={`${outgoingSlide.show.title} logo`}
              className="h-auto max-h-full w-full object-contain object-left transition-opacity duration-700 ease-out"
              loading="eager"
              decoding="async"
            />
          </div>
        ) : null}

        {currentShow.clearLogoUrl ? (
          <div
            className={`pointer-events-none absolute hidden drop-shadow-[0_22px_40px_rgba(0,0,0,0.5)] transition-all duration-700 ease-out md:block ${isTransitioning ? "opacity-100 scale-100 blur-0" : "opacity-100 scale-100 blur-0"}`}
            style={{
              width: currentLogoLayout.width,
              maxHeight: currentLogoLayout.maxHeight,
              left: currentLogoLayout.left,
              top: currentLogoLayout.top,
              transform: `translate3d(0, ${logoOffsetY}px, 0)`,
            }}
          >
            <img
              src={balanceImageResolution(currentShow.clearLogoUrl, "logo") ?? currentShow.clearLogoUrl}
              alt={`${currentShow.title} logo`}
              className={`h-auto max-h-full w-full object-contain object-left transition-all duration-700 ease-out ${isTransitioning ? "animate-hero-logo-in" : ""}`}
              loading="eager"
              decoding="async"
            />
          </div>
        ) : null}

        <div className="absolute bottom-0 left-0 flex flex-col justify-end p-5 sm:p-8 lg:p-12">
          {!currentShow.clearLogoUrl ? (
            <h1 className="mb-6 max-w-2xl text-4xl font-bold tracking-tight text-white drop-shadow-lg transition-opacity duration-500 sm:text-5xl lg:text-7xl">
              {currentShow.title}
            </h1>
          ) : null}

          {titleMetadata.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold text-white/84 sm:text-sm">
              {titleMetadata.map((part, index) => (
                <span key={`${part.kind}:${part.label}`} className="inline-flex items-center gap-2">
                  {index > 0 ? <span className="h-1 w-1 rounded-full bg-white/34" /> : null}
                  {part.kind === "rating" ? <img src="/rating-icon.png" alt="" className="h-4 w-4 shrink-0" /> : null}
                  {part.label}
                </span>
              ))}
            </div>
          ) : null}
          {titleDescription ? (
            <p className="mb-4 line-clamp-2 max-w-xl text-sm leading-5 text-white/68">{titleDescription}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onPlay}
              className="flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-black transition-transform hover:scale-105 sm:px-7"
            >
              <Play className="h-5 w-5 fill-black" strokeWidth={0} />
              Play
            </button>
            {onToggleFavorite ? (
              <button
                onClick={onToggleFavorite}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
              >
                <Heart className={`h-5 w-5 ${currentShow.isFavorite ? "fill-red-500 text-red-500" : ""}`} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="absolute inset-y-0 left-3 hidden items-center md:flex">
          <button
            onClick={onPrev}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/28 text-white/78 backdrop-blur transition hover:bg-black/42 hover:text-white"
            aria-label="Previous featured title"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="absolute inset-y-0 right-3 hidden items-center md:flex">
          <button
            onClick={onNext}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/28 text-white/78 backdrop-blur transition hover:bg-black/42 hover:text-white"
            aria-label="Next featured title"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-white/8">
          <div
            key={progressKey}
            className="h-full bg-white/80"
            style={{
              animation: `hero-progress ${progressDurationMs}ms linear forwards`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
