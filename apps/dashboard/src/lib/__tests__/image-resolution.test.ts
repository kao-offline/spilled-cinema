import { describe, expect, it } from "vitest";
import { balanceImageResolution, balancedBackgroundImage } from "../image-resolution";

describe("image resolution balancing", () => {
  it("downshifts TMDB poster originals for card slots", () => {
    expect(balanceImageResolution("https://image.tmdb.org/t/p/original/abc123.jpg", "poster-card")).toBe(
      "https://image.tmdb.org/t/p/w342/abc123.jpg",
    );
  });

  it("keeps TMDB hero backdrops at a large but bounded size", () => {
    expect(balanceImageResolution("https://image.tmdb.org/t/p/original/backdrop.jpg", "backdrop-hero")).toBe(
      "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
    );
  });

  it("reduces generic query-width image URLs without upscaling small sources", () => {
    expect(balanceImageResolution("https://images.example.test/photo.jpg?w=2000&q=80", "poster-thumb")).toBe(
      "https://images.example.test/photo.jpg?w=185&q=80",
    );
    expect(balanceImageResolution("https://images.example.test/photo.jpg?w=120&q=80", "poster-thumb")).toBe(
      "https://images.example.test/photo.jpg?w=120&q=80",
    );
  });

  it("leaves unknown URL shapes untouched", () => {
    expect(balanceImageResolution("https://cdn.example.test/assets/full/poster.jpg", "poster-card")).toBe(
      "https://cdn.example.test/assets/full/poster.jpg",
    );
  });

  it("builds background-image styles with balanced URLs", () => {
    expect(balancedBackgroundImage("https://image.tmdb.org/t/p/original/poster.jpg", "poster-card")).toEqual({
      backgroundImage: "url(https://image.tmdb.org/t/p/w342/poster.jpg)",
    });
  });
});
