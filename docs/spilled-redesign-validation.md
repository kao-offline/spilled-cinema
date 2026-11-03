# Approved redesign validation

Work is isolated on `feat/spilled-approved-redesign`, starting from committed
revision `16d07b5379d5cd88dfd7ebc38ca5c7842d86cbc8`. The original dirty checkout
is not part of this change. The import popup retains its existing UI.

## Design sources

Read the handoff README and implementation notes, then connected to the live
pen.dev MCP document `spilled.pen`. Compared screenshots and enabled nodes in
Home `S92bO`, details `HZr4D`, desktop player `vlNDS`, landscape phone player
`RTnLs`, catalog `tfkt8`, and interaction states `wKDn3`. Disabled older concepts
are excluded. TV uses the approved Home composition and still requires review.

Measured browser comparisons:

| Surface | Reference and measured implementation |
| --- | --- |
| Home Up Next | Compact 218 × 122; focused 390 × 246 with glass footer |
| Details at 1518 × 900 | Copy x64/y298; hero 676.53 high; episode grid y836.53, tiles 184 high |
| Desktop player | Bottom panel x42/y734, 1434 × 124; title x64/y630 |
| Phone at 844 × 390 | Center play 56; surrounding touch targets at least 44; five-tool group; bottom timeline |
| Catalog at 1119 × 900 | Hero 566.78 high; search field 768 × 64 at y277.09; content inset64 |

Scrollbar width and actual metadata can change wrapping. Missing ratings, cast,
logos, or trailers are not replaced with reference-screen values.

## Functional checks

- Imported real Lioness and CIA through existing provider search and import UI.
- Played Lioness S3 E8 through the real NextDrop source (duration 1:10:54).
  Confirmed continued playback while episode artwork enriched, keyboard seek
  of 10 seconds, caption toggle, native fullscreen and Escape.
- Verified actual Czech, English and Slovak rows and an unspecified-language
  subtitle option under More. Disabled SUB/DUB cells reflect unavailable choices.
  More opens, lists actual options, and closes with Escape.
- Checked favorite toggle, source navigation, catalog search and active filters,
  desktop keyboard navigation and TV directional focus. Focused Up Next expands
  to 390 × 246 and shows its footer.
- Checked desktop, 390 × 844 portrait and 844 × 390 landscape sizing. No page
  horizontal overflow or unnamed visible buttons in the checked phone views.
  Phone settings retains volume and download actions.
- Emulated reduced motion and reduced transparency in pen.dev's integrated
  browser. Both media queries matched; glass controls used a solid background
  and `backdrop-filter: none`. Reviewed text scrims and secondary-text contrast.
- Final poster fallback preserves aspect ratio and fades on both axes; palette
  extraction uses real artwork with a blurred fallback for cross-origin images.

## Automated validation

Dashboard Vitest: 342 tests across 63 files passed. Dashboard ESLint passed.
Dashboard TypeScript/Vite production build and server TypeScript/esbuild passed.
Existing large-chunk build warning remains. Regression coverage includes language
selection, artwork palette extraction, TMDB trailer filtering, provider metadata,
stream disconnection and authenticated-frame tampering.

## Verification limits

### Artwork, animation and player follow-up

Source navigation now has a sliding active indicator and a brief content fade,
both disabled under reduced motion. Up Next uses fixed slots with an overlapping
artwork layer: measured a focused card at 390 × 246 while both neighboring slot
rectangles and the following heading stayed unchanged.

Large Home/carousel and title-detail surfaces use the selected poster and separate
logo. Portrait cards use posters; standalone horizontal cards use WLogo artwork.
Missing WLogo artwork retains a title placeholder rather than silently displaying
a different image type. Remote WLogo fields are preserved through rail mapping.
The artwork picker reads and preserves the canonical slots when applying changes.

Artwork lookups no longer combine alternate media types or relax ambiguous-title
confidence for the picker. Known years filter search results, conflicting saved
TMDB IDs are resolved again, and TVDB/Fanart lookups follow TMDB's linked identity
when available. Regression fixtures cover same-name series, mismatched years,
ambiguous matches and stale IDs. Previously saved incorrect artwork is not erased;
it can be replaced through the existing artwork picker/refresh action.

Removed visible trailer play/pause buttons and disabled embedded player controls.
Episode still caching keeps opaque cross-origin image URLs instead of creating
empty blobs. Real Lioness selector stills loaded at 1920px natural width; the
focused selector border computed to rgb(169,216,255). Native fullscreen playback
was verified with bottom controls at opacity 0 and pointer-events none after
inactivity. Controls restore on interaction and stay visible for paused playback,
settings, or keyboard interaction. Full suite: 349 tests across 65 files passed.

Production integration is coordinated with the active account/library/playback
thread. This follow-up must be applied as a delta onto its routing fixes, not
deployed independently from the older redesign baseline.

### Full-page artwork continuation follow-up

Read the enabled backdrop layers directly from pen.dev: Home `yhj27` uses an
extended artwork image, details `uC5rI` uses 110px blur with .62 opacity and a
contrast tint, and catalog `QCXx2` uses a full-height extended image plus
`#08111a78`. The shared atmosphere now extends actual artwork across the page
with heavy blur and these per-surface tints, instead of cover-cropping it into a
narrow strip or relying on faint palette glows. Primary hero artwork keeps its
aspect ratio. Home's background is unmounted on provider tabs so it cannot bleed
behind their own artwork. Catalog's separate opaque hero fade is removed.
Verified full-height backgrounds with real Home, SvetSerialu and Bombuj data,
desktop and phone sizing, and the shared series/movie details component.

The preview lacks working shared artwork credentials: the artwork service returns
Unauthorized, and official TMDB trailer lookup consequently falls back to the
poster. Live trailer playback and artwork enrichment need a configured TMDB key
through the existing artwork settings/service. No fabricated metadata is used.
Hardware TV remote testing and a complete offline download were not performed.

PR #15 has a working `spilled-cinema` Vercel project. The separate legacy
`dashboard` Vercel project builds the monorepo root, where `npm run build` does
not exist; that project configuration failure is outside this branch. Deploy
review previews only; production remains unchanged. Rollback is the previous
preview or revision `38c8cbe45ac3fd740c2dc3994f4b4d4217e6f5df`.
