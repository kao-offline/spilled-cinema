// tools/tv-mode-check.mjs
// Lean-back TV Mode verification for SpilledCinema.
// Runs with plain node — no dependencies.
//
// What it verifies (Apple tvOS + Android Leanback basics):
//  1. ISOLATION .... normal UI untouched: no `.tv-mode` selector may restyle
//     desktop components. Only the allowlist below may use `.tv-mode`.
//  2. SURFACE ...... dedicated TvHomePage rendered INSTEAD of desktop home,
//     with overscan gutters, 10-foot targets, Up Next first, <=2 hero actions.
//  3. WIRING ....... opt-in persistence (read/write/apply), role=switch toggle,
//     search opened from TV gets the scoped `.tv-search` class.
//  4. REMOTE ....... arrows + Enter spatial nav, Escape closes search,
//     Home key returns, instant scroll in TV mode.
//  5. ARTWORK ...... TV (big screen) must NOT force economy artwork tier.
//
// Usage:
//   node tools/tv-mode-check.mjs            (from repo root)
// Exit code 0 = all green, 1 = any failure.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = join(ROOT, "apps", "dashboard", "src");
const read = (rel) => readFileSync(join(DASH, rel), "utf8");

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("TV Mode check — SpilledCinema lean-back surface\n");

// ---- 1. ISOLATION: .tv-mode must stay a flag, visuals live under .tv-home ----
const css = read("index.css");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const tvModeSelectors = cssNoComments
  .split("}")
  .map((chunk) => chunk.split("{")[0] ?? "")
  .flatMap((sel) => sel.split(","))
  .map((s) => s.trim())
  .filter((s) => s.includes(".tv-mode"));

// Allowlist: focus ring, shared-animation calming, scoped TV search panel,
// and reduced-motion guards. Everything else under .tv-mode is a leak into
// the desktop UI (the 2026-08-06 class of bug: global overrides resizing
// episode browsers, player selectors, command palette, ...).
const ALLOWED = [
  /\.tv-mode\s+(button|a|input|select|\[role="button"\]):focus-visible/,
  /\.tv-mode\s+\.animate-/,
  /\.tv-mode\s+\.tv-search/,
  /\.tv-mode::view-transition/,
];
const leaks = tvModeSelectors.filter(
  (sel) => !ALLOWED.some((re) => re.test(sel)),
);
console.log("[1] isolation (.tv-mode stays a flag)");
check(
  `no leaky .tv-mode selectors (${tvModeSelectors.length} scanned)`,
  leaks.length === 0,
  leaks.slice(0, 8).join(" | "),
);
check(
  "dedicated surface styles scoped to .tv-home",
  css.includes(".tv-home .tv-nav-button") &&
    css.includes(".tv-home .tv-hero-action") &&
    css.includes(".tv-home .tv-card:focus-visible"),
  "expected .tv-home nav/hero/card rules",
);
check(
  "no global font-size hack keyed on .tv-mode",
  !/\.tv-mode[\s\S]{0,120}?font-size:\s*\d/.test(
    tvModeSelectors.join("\n"),
  ) || css.includes(".tv-mode .tv-search input"),
  "font-size under .tv-mode is only allowed for .tv-search input",
);
const fontSizeLeaks = tvModeSelectors.filter(
  (s) => /font-size/.test(css.split(s)[1]?.slice(0, 200) ?? "") && !s.includes(".tv-search"),
);
check("font-size never leaks via .tv-mode (except .tv-search)", fontSizeLeaks.length === 0, fontSizeLeaks.slice(0, 4).join(" | "));

// ---- 2. SURFACE: dedicated 10-foot home ----
console.log("[2] surface (TvHomePage, rendered INSTEAD)");
const tvHomePath = join(DASH, "components", "TvHomePage.tsx");
check("TvHomePage.tsx exists", existsSync(tvHomePath));
const tvHome = existsSync(tvHomePath) ? readFileSync(tvHomePath, "utf8") : "";
check("root owns .tv-home scope", tvHome.includes('className="tv-home'));
check("overscan-safe gutters (5vw)", tvHome.includes("px-[5vw]"));
check(
  "10-foot type via clamp()",
  /clamp\(.*rem.*vw/.test(tvHome),
  "expected clamp() fluid type",
);
check(
  "hero has Play + Details (<=2 primary actions)",
  tvHome.includes("tv-hero-action") && tvHome.includes("Play") && tvHome.includes("Details"),
);
check(
  "no 'Tonight on Spilled' eyebrow",
  !/tonight on spilled/i.test(tvHome),
  "hero eyebrow must be gone",
);
check(
  "no vertical edge line",
  !/via-cyan-200\/45/.test(tvHome),
  "hero edge line must be gone",
);
check(
  "no streaming-ready status clutter in hero",
  !/STREAMING READY/i.test(tvHome),
  "hero button row is Play + Details only",
);
check("movies resume as plain 'Continue'", /"Continue"/.test(tvHome) && !/Resume film/.test(tvHome));
check("Up Next lane first (lean-back resume)", /Continue watching|up-next/i.test(tvHome));
check("rails snap for D-pad travel", css.includes(".tv-home .tv-rail-scroll"));
check(
  "rails have focus headroom (pt-4, no clipping)",
  tvHome.includes("pt-4") && !/overflow-x-auto px-\[5vw\] pb-5 pt-1/.test(tvHome),
  "rail scrollers need pt-4 so the focus ring never clips",
);
check(
  "entrance motion scoped to .tv-home",
  css.includes(".tv-home .tv-enter") && css.includes("tv-home-in"),
  "expected tv-home-in keyframes + .tv-enter",
);
check(
  "rails auto-drift as carousels (TvAutoRail, smooth, pausable)",
  tvHome.includes("TvAutoRail") &&
    tvHome.includes(":focus-within") &&
    tvHome.includes("prefers-reduced-motion") &&
    tvHome.includes('behavior: "smooth"'),
  "rails must drift smoothly and yield to focus/hover/motion",
);
check(
  "hero backdrop has ambient drift",
  css.includes(".tv-home .tv-hero-drift") && css.includes("tv-hero-drift"),
  "expected tv-hero-drift keyframes",
);
check(
  "nav is Home + SvetSerialu + Bombuj + Search (no Library/Explore)",
  tvHome.includes("SvetSerialu") &&
    tvHome.includes("Bombuj") &&
    tvHome.includes("Search") &&
    !/onOpenLibrary|onOpenExplore/.test(tvHome),
  "TV nav must drop Library/Explore for provider feeds",
);
check(
  "provider feeds render under TV nav (TvProviderPage)",
  tvHome.includes("TvProviderPage") && tvHome.includes("ProviderHomeSurface"),
  "expected TvProviderPage wrapping ProviderHomeSurface",
);
const providerSurface = read("components/ProviderHomeSurface.tsx");
check(
  "feed hero spans full width on TV (no Up overshoot to nav)",
  providerSurface.includes("tv") &&
    providerSurface.includes("w-full") &&
    providerSurface.includes("px-[5vw]"),
  "TV feed controls must overlap every grid column",
);
const cinematic = read("components/CinematicHomePage.tsx");
check(
  "TV home replaces desktop home (early return, not overlay)",
  /if\s*\(\s*tvModeEnabled\s*\)\s*\{[\s\S]*?return/.test(cinematic),
  "expected `if (tvModeEnabled) { return ...TvHomePage... }`",
);
check(
  "TV home follows recommendations with the full library",
  /tvLibraryRails/.test(cinematic) && /libraryLimit:\s*Number\.POSITIVE_INFINITY/.test(cinematic)
    && /From your library/.test(cinematic) && /All titles/.test(cinematic),
  "TV branch must render banner artwork followed by an uncapped all-titles library rail",
);
check(
  "library cards render clean (title baked into art, no overlay)",
  tvHome.includes('item.kind !== "local"'),
  "text overlay must be feed-only",
);

// ---- 3. WIRING: opt-in, persistent, return path ----
console.log("[3] wiring (opt-in + return path)");
const tvModeLib = read("lib/tv-mode.ts");
check("persisted under spilled.tv-mode.v1", tvModeLib.includes("spilled.tv-mode.v1"));
const app = read("App.tsx");
check("App persists toggle (read/write/apply)", app.includes("readTvMode(") && app.includes("writeTvMode(") && app.includes("applyTvMode("));
const toggle = read("components/TvModeToggle.tsx");
check("toggle is role=switch with aria-checked", toggle.includes('role="switch"') && toggle.includes("aria-checked"));
const cmd = read("components/CommandMenu.tsx");
check("TV search gets scoped .tv-search class", cmd.includes("tv-search"));
check("return path: Home key goes back to library home", app.includes('"Home"') || app.includes("'Home'") || app.includes("handleRemoteHome"));

// ---- 4. REMOTE: d-pad + back + instant travel ----
console.log("[4] remote (d-pad first, no hover-only)");
const spatial = read("components/SpatialNavigationController.tsx");
check("arrow-key spatial navigation", ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].every((k) => spatial.includes(k)));
check("Enter activates focused card", spatial.includes('"Enter"') || spatial.includes("'Enter'"));
check("remote glides smoothly to the selected card", spatial.includes('behavior: "smooth"') && !spatial.includes('"auto"'));
check(
  "vertical moves center the selection (page travels with focus)",
  spatial.includes('block: vertical ? "center" : "nearest"'),
  "Up/Down must center, or context strands cut off above",
);
check(
  "selection lands clear of the fixed header",
  css.includes("scroll-margin-top: clamp(6.5rem, 9vw, 8rem)"),
  "rail cards need header-clear top margin or Up parks focus invisibly",
);
check("Escape closes search", cmd.includes('"Escape"') || cmd.includes("'Escape'") || app.includes("Escape"));
check("hover never required (focus-visible styled)", css.includes(":focus-visible"));
check("ranked walk order (no flicker between cards)", spatial.includes("rankSpatialCandidates"));
check("repeated press never bounces straight back", /ranked\[1\]/.test(spatial));
check("mouse-only controls skipped by remote (tabindex=-1)", spatial.includes('tabindex') && spatial.includes('-1'));
const card = read("components/HomeMediaCard.tsx");
check(
  "feed cards expose one remote stop (dots mouse-only)",
  card.includes("tabIndex={-1}"),
  "overflow button must be mouse-only",
);
check(
  "card title is not a separate tab stop",
  !/<button[^>]*min-w-0 flex-1 text-left/.test(card),
  "title must be static text, not a second button",
);
check(
  "card artwork owns focus with a label",
  /aria-label=\{`/.test(card),
  "single focus stop needs an accessible name",
);
const nav = read("lib/spatial-navigation.ts");
check("stable ranked candidates in nav lib", nav.includes("rankSpatialCandidates"));
check(
  "arrows never leave their lane (no diagonal jumps)",
  nav.includes("LANE_TOLERANCE_PX") && /leaves its\s*\n?\s*\*?\s*lane|NEVER leaves its/.test(nav),
);
check(
  "fixed header scored in document coords (can't steal Up presses)",
  spatial.includes("isViewportDocked") && spatial.includes("documentRect") && spatial.includes("window.scrollY"),
  "viewport rects let the fixed nav win every scrolled Up press",
);

// ---- 5. ARTWORK: big screen = full pixels ----
console.log("[5] artwork (10-foot = full res)");
const imgRes = read("lib/image-resolution.ts");
check(
  "TV mode does not force economy tier",
  !/scenario\.tvMode\s*\|\|/.test(imgRes) && !/tvMode\s*&&/.test(imgRes.replace(/tvMode\?: boolean/, "")),
  "shouldUseEconomyArtwork must ignore tvMode",
);

console.log("[6] tv detail + player (lean-back, simplified)");
const tvDetail = read("components/TvShowDetail.tsx");
check("dedicated TV detail exists", tvDetail.includes("TvShowDetail"));
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
check(
  "TV detail drops actors/directors/recommended/downloads",
  !/actor|director|recommend|Download|ArtworkPicker|Favorite/i.test(stripComments(tvDetail)),
  "detail must be hero + Play + episodes only",
);
check("TV detail episodes are big single-stop rows", tvDetail.includes("tv-episode-row-big"));
check("TV detail has season pills", tvDetail.includes("tv-season-pill"));
const showDetail = read("components/ShowDetail.tsx");
check("detail branches to TV surface in tv mode", showDetail.includes("TvShowDetail") && showDetail.includes("readTvMode"));
const tvPick = read("components/TvEpisodePicker.tsx");
check("TV player episode picker exists", tvPick.includes("TvEpisodePicker"));
check(
  "picker rows are single-stop (no micro-buttons)",
  !/Mark as|Download|cancel|delete/i.test(stripComments(tvPick)),
  "picker rows must just play",
);
const player = read("components/PlayerModal.tsx");
check("player swaps in TV picker in tv mode", player.includes("TvEpisodePicker") && player.includes("handleTvEpisodePick"));
check(
  "TV detail/player styles scoped (.tv-detail/.tv-pick)",
  css.includes(".tv-detail .tv-back") && css.includes(".tv-episode-row-big") && css.includes(".tv-pick-row"),
  "expected scoped 10-foot styles",
);
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log("Failed checks:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("TV Mode is clean: desktop UI untouched, dedicated 10-foot surface, remote-first.");
