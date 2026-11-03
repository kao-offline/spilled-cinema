import { Download, Heart, Play, Plus } from "lucide-react";
import type { ImportedShow } from "../lib/types";
import { balanceImageResolution } from "../lib/image-resolution";
import { getHomeHeroArtwork, getTitleDescription, getTitleMetadataParts } from "../lib/media-library";

type HomeHeroProps = {
  featuredShow: ImportedShow | null;
  downloadedCount: number;
  onPlay: () => void;
  onAdd: () => void;
  onOpenSearch: () => void;
  onToggleFavorite: () => void;
};

export function HomeHero({ featuredShow, downloadedCount, onPlay, onAdd, onOpenSearch, onToggleFavorite }: HomeHeroProps) {
  if (!featuredShow) return <section className="cinema-home-hero cinema-home-empty">
    <div className="cinema-hero-copy">
      <h1>Spilled</h1>
      <p>Build your cinema vault from search. Add a title from your sources, then it becomes part of the homepage.</p>
      <div className="cinema-hero-actions">
        <button className="cinema-primary" onClick={onOpenSearch}><Play size={16} fill="currentColor" />Search</button>
        <button className="cinema-glass" onClick={onAdd}><Plus size={16} />Add titles</button>
      </div>
    </div>
  </section>;
  const { imageUrl, logoUrl } = getHomeHeroArtwork(featuredShow);
  const metadata = getTitleMetadataParts(featuredShow);
  const description = getTitleDescription(featuredShow);
  return <section className="cinema-home-hero">
    <div className="cinema-hero-artwork" aria-hidden="true">
      {imageUrl ? <img src={balanceImageResolution(imageUrl, "backdrop-hero") ?? imageUrl} alt="" fetchPriority="high" /> : null}
    </div>
    <div className="cinema-hero-copy">
      {logoUrl ? <div className="cinema-hero-logo"><img src={balanceImageResolution(logoUrl, "logo") ?? logoUrl} alt={featuredShow.title} /></div> : <h1>{featuredShow.title}</h1>}
      {metadata.length ? <div className="cinema-title-metadata">{metadata.map((part) => <span key={`${part.kind}:${part.label}`}>{part.kind === "rating" ? <img src="/rating-icon.png" alt="" /> : null}{part.label}</span>)}</div> : null}
      {description ? <p>{description}</p> : null}
      <div className="cinema-hero-actions">
        <button type="button" className="cinema-primary" onClick={onPlay}><Play size={16} fill="currentColor" strokeWidth={0} />Play</button>
        <button type="button" className="cinema-glass cinema-icon" onClick={onToggleFavorite} aria-label={featuredShow.isFavorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={Boolean(featuredShow.isFavorite)}><Heart size={20} fill={featuredShow.isFavorite ? "currentColor" : "none"} /></button>
        <span className="cinema-glass cinema-download-status"><Download size={16} />{downloadedCount > 0 ? `${downloadedCount} saved` : "Not downloaded"}</span>
      </div>
    </div>
  </section>;
}
