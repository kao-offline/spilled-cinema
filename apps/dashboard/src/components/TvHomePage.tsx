import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  Info,
  Play,
  Search,
  Settings,
  Tv,
  UserRound,
} from "lucide-react";
import type { HomepageRail, HomepageRailItem } from "../lib/homepage-rails";
import type { RecommendedWatchItem } from "../lib/home-personalization";
import { balancedBackgroundImage, balanceImageResolution } from "../lib/image-resolution";
import {
  getOverlayBannerArtwork,
  getShowArtwork,
  getTitleDescription,
  getTitleMetadataParts,
} from "../lib/media-library";
import type { ExploreItem, ImportedShow } from "../lib/types";
import { planAutoRailStep } from "../lib/tv-auto-rail";
import { ProviderHomeSurface } from "./ProviderHomeSurface";
import { ProviderIcon } from "./ProviderIcon";

export type TvSection = "home" | "svetserialu" | "bombuj";

/**
 * Carousel drift for TV rails: one smooth page every few seconds,
 * ping-ponging at the ends. Remote-first manners — it NEVER moves while:
 * - focus is inside the rail (the D-pad is driving),
 * - the pointer hovers it,
 * - the user recently scrolled it by hand (8s cooldown),
 * - reduced motion is preferred or the tab is hidden.
 */
function TvAutoRail({ children, className }: { children: ReactNode; className?: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ dir: 1 as 1 | -1, resumeAt: 0, hovering: false });

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const markManual = () => {
      stateRef.current.resumeAt = Date.now() + 8000;
    };
    const onEnter = () => {
      stateRef.current.hovering = true;
    };
    const onLeave = () => {
      stateRef.current.hovering = false;
    };
    node.addEventListener("pointerdown", markManual);
    node.addEventListener("wheel", markManual, { passive: true });
    node.addEventListener("keydown", markManual);
    node.addEventListener("pointerenter", onEnter);
    node.addEventListener("pointerleave", onLeave);

    const timer = window.setInterval(() => {
      const state = stateRef.current;
      if (document.hidden || reduceMotion.matches) return;
      if (state.hovering || Date.now() < state.resumeAt) return;
      if (node.matches(":focus-within")) return;
      const max = node.scrollWidth - node.clientWidth;
      const step = Math.max(240, node.clientWidth * 0.8);
      const plan = planAutoRailStep({ scrollLeft: node.scrollLeft, max, dir: state.dir, step });
      if (plan.settled) return;
      state.dir = plan.dir;
      node.scrollTo({ left: plan.next, behavior: "smooth" });
    }, 4000);

    return () => {
      window.clearInterval(timer);
      node.removeEventListener("pointerdown", markManual);
      node.removeEventListener("wheel", markManual);
      node.removeEventListener("keydown", markManual);
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={scrollerRef} className={className}>
      {children}
    </div>
  );
}

type TvTopNavProps = {
  activeSection: TvSection;
  onSelectSection: (section: TvSection) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  accountLabel?: string | null;
};

export function TvTopNav(props: TvTopNavProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-[clamp(5.5rem,8vw,7rem)] items-center gap-6 bg-gradient-to-b from-black/90 via-black/55 to-transparent px-[5vw]">
      <button type="button" onClick={() => props.onSelectSection("home")} className="tv-nav-button mr-[2vw] rounded-2xl px-2 py-3" aria-label="Spilled home">
        <img src="/Spilled.svg" alt="Spilled" className="h-[clamp(2.3rem,3vw,3.25rem)] w-auto brightness-0 invert" />
      </button>
      <nav className="flex items-center gap-2" aria-label="TV navigation">
        <button
          type="button"
          onClick={() => props.onSelectSection("home")}
          className={`tv-nav-button${props.activeSection === "home" ? " is-active" : ""}`}
          aria-current={props.activeSection === "home" ? "page" : undefined}
        >
          <Tv />Home
        </button>
        <button
          type="button"
          onClick={() => props.onSelectSection("svetserialu")}
          className={`tv-nav-button${props.activeSection === "svetserialu" ? " is-active" : ""}`}
          aria-current={props.activeSection === "svetserialu" ? "page" : undefined}
        >
          <ProviderIcon provider="svetserialu" className="h-6 w-6" />SvetSerialu
        </button>
        <button
          type="button"
          onClick={() => props.onSelectSection("bombuj")}
          className={`tv-nav-button${props.activeSection === "bombuj" ? " is-active" : ""}`}
          aria-current={props.activeSection === "bombuj" ? "page" : undefined}
        >
          <ProviderIcon provider="bombuj" className="h-6 w-6" />Bombuj
        </button>
        <button type="button" onClick={props.onOpenSearch} className="tv-nav-button"><Search />Search</button>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={props.onOpenAccount} className="tv-nav-button" aria-label={props.accountLabel ? `Account, ${props.accountLabel}` : "Account"}><UserRound /><span className="max-w-36 truncate">{props.accountLabel ?? "Account"}</span></button>
        <button type="button" onClick={props.onOpenSettings} className="tv-nav-button tv-icon-button" aria-label="Settings"><Settings /></button>
      </div>
    </header>
  );
}

type TvHomePageProps = {
  featuredShow: ImportedShow | null;
  rails: HomepageRail[];
  recommendedWatchItems: RecommendedWatchItem[];
  activeSection: TvSection;
  onSelectSection: (section: TvSection) => void;
  accountLabel?: string | null;
  onPlayFeatured: () => void;
  onOpenFeatured: () => void;
  onOpenLocal: (item: HomepageRailItem) => void;
  onImportRemote: (item: HomepageRailItem) => void;
  onPlayEpisode: (item: RecommendedWatchItem) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
};

function railArtwork(item: HomepageRailItem) {
  if (item.kind === "local") {
    return item.bannerWithLogoUrl ?? item.homepageBannerUrl ?? item.backdropUrl ?? item.bannerUrl ?? item.homepagePosterUrl ?? item.posterUrl ?? null;
  }
  return item.backdropUrl ?? item.bannerUrl ?? item.posterUrl ?? null;
}

function TvRailCard({ item, onSelect }: { item: HomepageRailItem; onSelect: () => void }) {
  const imageUrl = balanceImageResolution(railArtwork(item), "backdrop-thumb");
  // Library art already carries the show logo baked in (bannerWithLogoUrl),
  // so library cards render clean with no text overlay. Feed cards keep
  // their label + status — provider art has no baked-in title.
  const showOverlay = item.kind !== "local" || !imageUrl;
  const status = item.kind === "local"
    ? item.downloadedCount > 0 ? `${item.downloadedCount} downloaded` : "In your library"
    : item.importStatus === "importing" ? "Adding to library" : item.inVault ? "In your library" : `From ${item.provider}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="tv-card group relative aspect-video w-[clamp(19rem,25vw,29rem)] shrink-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#151820] text-left shadow-[0_18px_45px_rgba(0,0,0,.35)] transition duration-200"
      aria-label={`${item.kind === "local" ? "Open" : "Add"} ${item.title}`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" loading="lazy" decoding="async" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(103,232,249,.16),transparent_36%),linear-gradient(145deg,#171b24,#090b10)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/16 to-black/5" />
      {showOverlay ? (
        <div className="absolute inset-x-0 bottom-0 p-5">
          <div className="line-clamp-1 text-[clamp(1rem,1.3vw,1.35rem)] font-black tracking-[-0.02em] text-white">{item.title}</div>
          <div className="mt-1.5 flex items-center gap-2 text-[clamp(.7rem,.8vw,.84rem)] font-bold uppercase tracking-[.12em] text-white/52">
            <span>{status}</span>
            <span className="h-1 w-1 rounded-full bg-cyan-200/55" />
            <span className="truncate">{item.subtitle.split("  |  ")[0]}</span>
          </div>
        </div>
      ) : null}
    </button>
  );
}

function TvRail({ rail, index, onOpenLocal, onImportRemote }: {
  rail: HomepageRail;
  index: number;
  onOpenLocal: (item: HomepageRailItem) => void;
  onImportRemote: (item: HomepageRailItem) => void;
}) {
  return (
    <section className="tv-rail tv-enter py-5" aria-labelledby={`tv-rail-${rail.id}`} style={{ "--tv-delay": `${140 + index * 70}ms` } as CSSProperties}>
      <div className="mb-4 flex items-end justify-between px-[5vw]">
        <h2 id={`tv-rail-${rail.id}`} className="text-[clamp(1.35rem,1.8vw,2rem)] font-black tracking-[-0.035em] text-white">{rail.title}</h2>
        <span className="text-[clamp(.66rem,.78vw,.82rem)] font-black uppercase tracking-[.2em] text-white/32">{rail.items.length} titles</span>
      </div>
      <TvAutoRail className="tv-rail-scroll no-scrollbar flex gap-[clamp(.8rem,1.1vw,1.35rem)] overflow-x-auto px-[5vw] pb-6 pt-4">
        {rail.items.map((item) => (
          <TvRailCard
            key={item.id}
            item={item}
            onSelect={() => item.kind === "local" ? onOpenLocal(item) : onImportRemote(item)}
          />
        ))}
      </TvAutoRail>
    </section>
  );
}

function TvUpNext({ items, onPlay }: { items: RecommendedWatchItem[]; onPlay: (item: RecommendedWatchItem) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="tv-rail tv-enter py-5" aria-labelledby="tv-up-next" style={{ "--tv-delay": "70ms" } as CSSProperties}>
      <div className="mb-4 px-[5vw]">
        <h2 id="tv-up-next" className="text-[clamp(1.35rem,1.8vw,2rem)] font-black tracking-[-0.035em] text-white">Continue watching</h2>
      </div>
      <TvAutoRail className="tv-rail-scroll no-scrollbar flex gap-[clamp(.8rem,1.1vw,1.35rem)] overflow-x-auto px-[5vw] pb-6 pt-4">
        {items.map((item) => {
          const artwork = getShowArtwork(item.show);
          const image = balanceImageResolution(item.episode.posterUrl ?? artwork.bannerUrl ?? artwork.bannerWithLogoUrl ?? artwork.posterUrl ?? null, "backdrop-thumb");
          const episodeLabel = item.show.mediaType === "movie" ? "Continue" : `S${Math.max(1, item.episode.seasonNumber)} E${item.episode.episodeNumber ?? 1}`;
          return (
            <button key={`${item.show.slug}:${item.episode.id}`} type="button" onClick={() => onPlay(item)} className="tv-card group relative aspect-video w-[clamp(20rem,28vw,32rem)] shrink-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#151820] text-left shadow-[0_18px_45px_rgba(0,0,0,.35)] transition duration-200">
              {image ? <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" loading="lazy" decoding="async" /> : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/15 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <div className="line-clamp-1 text-[clamp(1rem,1.3vw,1.35rem)] font-black text-white">{item.show.title}</div>
                <div className="mt-1 text-[clamp(.7rem,.8vw,.84rem)] font-bold uppercase tracking-[.14em] text-white/55">{episodeLabel}</div>
              </div>
              {item.progressPercent > 0 ? <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15"><div className="h-full bg-cyan-300" style={{ width: `${item.progressPercent}%` }} /></div> : null}
            </button>
          );
        })}
      </TvAutoRail>
    </section>
  );
}

export function TvHomePage(props: TvHomePageProps) {
  const artwork = props.featuredShow ? getOverlayBannerArtwork(props.featuredShow) : null;
  const metadata = props.featuredShow ? getTitleMetadataParts(props.featuredShow, { fallback: null }).map((part) => part.label).slice(0, 4) : [];
  const description = props.featuredShow ? getTitleDescription(props.featuredShow, null) : null;

  return (
    <div className="tv-home min-h-screen overflow-x-hidden bg-[#05070b] text-white selection:bg-cyan-200/25">
      <TvTopNav
        activeSection={props.activeSection}
        onSelectSection={props.onSelectSection}
        onOpenSearch={props.onOpenSearch}
        onOpenSettings={props.onOpenSettings}
        onOpenAccount={props.onOpenAccount}
        accountLabel={props.accountLabel}
      />

      <section className="relative min-h-[min(48rem,78vh)] overflow-hidden px-[5vw] pb-[clamp(5rem,8vh,8rem)] pt-[clamp(9rem,13vh,12rem)]">
        <div className="tv-hero-drift absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(artwork?.bannerUrl ?? null, "backdrop-hero")} />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,11,.97)_0%,rgba(5,7,11,.75)_38%,rgba(5,7,11,.2)_75%,rgba(5,7,11,.55)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-[#05070b]" />

        <div className="tv-enter-hero relative z-10 flex min-h-[min(29rem,53vh)] max-w-[min(48rem,52vw)] flex-col justify-end">
          {artwork?.logoUrl ? (
            <img src={balanceImageResolution(artwork.logoUrl, "logo") ?? artwork.logoUrl} alt={`${props.featuredShow?.title ?? "Featured"} logo`} className="mb-6 max-h-[clamp(7rem,15vh,11rem)] max-w-[min(38rem,42vw)] object-contain object-left-bottom drop-shadow-[0_20px_55px_rgba(0,0,0,.7)]" />
          ) : (
            <h1 className="mb-5 text-[clamp(3rem,5.8vw,6.2rem)] font-black leading-[.9] tracking-[-.055em] text-white">{props.featuredShow?.title ?? "Your cinema. Your couch."}</h1>
          )}
          {metadata.length > 0 ? <div className="mb-4 flex flex-wrap items-center gap-3 text-[clamp(.8rem,1vw,1.05rem)] font-black text-white/76">{metadata.map((part) => <span key={part} className="after:ml-3 after:text-cyan-200/50 after:content-['•'] last:after:hidden">{part}</span>)}</div> : null}
          <p className="line-clamp-3 max-w-[44rem] text-[clamp(.95rem,1.25vw,1.3rem)] font-medium leading-[1.55] text-white/68">{description ?? "Search your sources, build your library, and control everything from the remote."}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button type="button" onClick={props.onPlayFeatured} className="tv-hero-action tv-hero-primary"><Play className="fill-current" />{props.featuredShow ? "Play" : "Search"}</button>
            <button type="button" onClick={props.onOpenFeatured} className="tv-hero-action"><Info />Details</button>
          </div>
        </div>
      </section>

      <main className="relative z-10 -mt-[clamp(3.5rem,7vh,6rem)] pb-24">
        <TvUpNext items={props.recommendedWatchItems} onPlay={props.onPlayEpisode} />
        {props.rails.length > 0 ? props.rails.map((rail, index) => <TvRail key={rail.id} rail={rail} index={index} onOpenLocal={props.onOpenLocal} onImportRemote={props.onImportRemote} />) : props.recommendedWatchItems.length === 0 ? (
          <section className="tv-enter px-[5vw] py-12">
            <button type="button" onClick={props.onOpenSearch} className="tv-empty-card w-full rounded-[2rem] border border-white/10 bg-white/[.045] p-12 text-left">
              <span className="block text-[clamp(1.5rem,2.4vw,2.7rem)] font-black tracking-[-.04em]">Fill the big screen.</span>
              <span className="mt-2 block text-[clamp(.9rem,1.15vw,1.2rem)] text-white/48">Search connected sources and add your first title.</span>
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}

type TvProviderPageProps = {
  provider: "svetserialu" | "bombuj";
  activeSection: TvSection;
  onSelectSection: (section: TvSection) => void;
  accountLabel?: string | null;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onImportItem: (item: ExploreItem) => void;
  onOpenVaultItem: (item: ExploreItem) => void;
  isInVaultItem: (item: ExploreItem) => boolean;
  importActivity?: { key: string; status: "importing" | "added" | "already" | "busy" | "error" } | null;
};

export function TvProviderPage(props: TvProviderPageProps) {
  return (
    <div className="tv-home min-h-screen overflow-x-hidden bg-[#05070b] text-white selection:bg-cyan-200/25">
      <TvTopNav
        activeSection={props.activeSection}
        onSelectSection={props.onSelectSection}
        onOpenSearch={props.onOpenSearch}
        onOpenSettings={props.onOpenSettings}
        onOpenAccount={props.onOpenAccount}
        accountLabel={props.accountLabel}
      />
      <div className="tv-enter" key={props.provider}>
        <ProviderHomeSurface
          provider={props.provider}
          importActivity={props.importActivity}
          isInVault={props.isInVaultItem}
          onImport={props.onImportItem}
          onOpenVault={props.onOpenVaultItem}
          tv
        />
      </div>
    </div>
  );
}
