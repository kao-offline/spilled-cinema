import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: { request?: unknown; waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void }) => void> = {};
  const cached = new Response("cached shell");
  const cache = { match: vi.fn().mockResolvedValue(cached), addAll: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue(["unrelated-app", "spilled-library-episode-cache-1", "spilled-library-app-shell-old", "spilled-library-app-shell-test"]), delete: vi.fn().mockResolvedValue(true) };
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  const source = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8").replace('"__SPILLED_PRECACHE__"', JSON.stringify({ version: "test", assets: ["/index.html", "/assets/app.js"] }));
  runInNewContext(source, { self: { location: { origin: "https://app.example" }, clients: { claim: vi.fn() }, addEventListener: (name: string, handler: typeof handlers[string]) => { handlers[name] = handler; } }, caches, fetch: fetcher, URL, Response, AbortController, setTimeout, clearTimeout });
  return { handlers, caches, cache, fetcher };
}

describe("PWA shell", () => {
  it("precaches the exact build and deletes only old owned shell caches", async () => {
    const { handlers, caches, cache } = worker();
    let work!: Promise<unknown>;
    handlers.install({ waitUntil: (promise) => { work = promise; } });
    await work;
    expect(cache.addAll).toHaveBeenCalledWith(["/index.html", "/assets/app.js"]);
    handlers.activate({ waitUntil: (promise) => { work = promise; } });
    await work;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith("spilled-library-app-shell-old");
  });
  it("never intercepts authenticated API calls or media ranges", () => {
    const { handlers } = worker();
    const respondWith = vi.fn();
    handlers.fetch({ request: { url: "https://app.example/api/node/private/library", method: "GET", headers: new Headers() }, respondWith });
    handlers.fetch({ request: { url: "https://app.example/movie.mp4", method: "GET", headers: new Headers({ range: "bytes=100-" }) }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
  it("serves cached build assets immediately and falls back on offline navigation", async () => {
    const { handlers, fetcher } = worker();
    let response!: Promise<Response>;
    handlers.fetch({ request: { url: "https://app.example/assets/app.js", method: "GET", headers: new Headers() }, respondWith: (promise) => { response = promise; } });
    await response;
    expect(fetcher).not.toHaveBeenCalled();
    handlers.fetch({ request: { url: "https://app.example/watch/film", method: "GET", mode: "navigate", headers: new Headers() }, respondWith: (promise) => { response = promise; } });
    expect(await (await response).text()).toBe("cached shell");
  });
});
