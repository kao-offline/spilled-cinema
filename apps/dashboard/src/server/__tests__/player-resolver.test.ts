import { describe, expect, it } from "vitest";
import {
  chooseResolvedPlayerCandidate,
  shouldResolvePlayerUrl,
} from "../../../../server/src/player-resolver";

describe("player resolver helpers", () => {
  it("prefers iframe targets for 2embed-style wrappers", () => {
    const html = `
      <html>
        <body>
          <script>window.location.href="https://ads.example/redirect";</script>
          <iframe src="https://vidsrc.example/embed/movie/123"></iframe>
        </body>
      </html>
    `;

    expect(
      chooseResolvedPlayerCandidate(html, "https://2embed.to/embed/movie/123", "2embed"),
    ).toBe("https://vidsrc.example/embed/movie/123");
  });

  it("blocks moviesclub redirect wrappers and keeps the playable iframe", () => {
    const html = `
      <html>
        <head>
          <meta http-equiv="refresh" content="0;url=https://redirect.example/ad" />
        </head>
        <body>
          <iframe src="https://moviesclub-cdn.example/player/abc"></iframe>
        </body>
      </html>
    `;

    expect(
      chooseResolvedPlayerCandidate(html, "https://moviesclub.example/watch/abc", "moviesclub"),
    ).toBe("https://moviesclub-cdn.example/player/abc");
  });

  it("follows primewire redirect chains when present", () => {
    const html = `
      <html>
        <body>
          <script>top.location.href='https://primewire-cdn.example/embed/xyz';</script>
        </body>
      </html>
    `;

    expect(
      chooseResolvedPlayerCandidate(html, "https://primewire.example/watch/xyz", "primewire"),
    ).toBe("https://primewire-cdn.example/embed/xyz");
  });

  it("only resolves the providers that need wrapper handling", () => {
    expect(shouldResolvePlayerUrl("multiembed", "https://multiembed.mov/?video=1")).toBe(true);
    expect(shouldResolvePlayerUrl("streamtape", "https://streamtape.com/e/abc")).toBe(false);
  });
});
