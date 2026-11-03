import { useEffect, useState, type CSSProperties } from "react";
import { deriveArtworkPalette } from "../lib/artwork-palette";
import { balanceImageResolution } from "../lib/image-resolution";

export function ArtworkAtmosphere({ src }: { src: string | null | undefined }) {
  const [palette, setPalette] = useState<string[]>([]);
  useEffect(() => {
    let canceled = false;
    if (!src) { setPalette([]); return; }
    const image = new Image();
    const origin = new URL(src, location.href);
    if (origin.origin === location.origin || origin.hostname === "image.tmdb.org") image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24; canvas.height = 16;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context || canceled) return;
        context.drawImage(image, 0, 0, 24, 16);
        setPalette(deriveArtworkPalette(context.getImageData(0, 0, 24, 16).data, 24, 16));
      } catch { /* Cross-origin artwork retains the blurred image fallback. */ }
    };
    image.src = balanceImageResolution(src, "backdrop-thumb") ?? src;
    return () => { canceled = true; image.onload = null; };
  }, [src]);
  const style = {
    "--art-left": palette[0] ?? "#0b111c",
    "--art-center": palette[1] ?? "#0b111c",
    "--art-right": palette[2] ?? "#0b111c",
  } as CSSProperties;
  return <div className="cinema-atmosphere" style={style} aria-hidden="true">
    {src ? <div className="cinema-atmosphere-image" style={{ backgroundImage: `url(${JSON.stringify(src)})` }} /> : null}
    <div className="cinema-atmosphere-glow" />
  </div>;
}
