# SpilledCinema Default Connectors

This directory is the seed content for the default connector repository.

Host `spilled-connectors.json` at the root of a GitHub repository. In the app,
users can paste either the GitHub repository URL or the raw JSON URL in
Settings -> Sources -> Connector repositories.

The default repository currently publishes these integration ids:

- `svetserialu`
- `bombuj`
- `synova`
- `tmdb`
- `tvdb`
- `fanart`

Each integration can include a `runtime.entry` that points at an ESM file in
this repository. Runtime files may export the legacy functions:

- `getFeed({ moduleId, feedId, cursor, limit })`
- `search({ moduleId, query })`
- `importItem({ moduleId, slug, mediaType })`

Runtime files should also export a v2 adapter:

```js
export const integration = {
  apiVersion: 2,
  search,
  getFeed,
  resolveCandidateMetadata,
  resolvePlayers,
  resolveSubtitles,
  resolveDownloads,
  importFallback,
};
```

Only export functions for capabilities declared in `spilled-connectors.json`.
The app passes a constrained context into v2 functions and shared Convex API keys
are never exposed to repository code. Central metadata/artwork integrations such
as TMDB, TVDB, and Fanart use the app's secure Convex broker instead of runtime
JavaScript from this repository.
