# SpilledCinema Default Connectors

This directory is the seed content for the default connector repository.

Host `spilled-connectors.json` at the root of a GitHub repository. In the app,
users can paste either the GitHub repository URL or the raw JSON URL in
Settings -> Sources -> Connector repositories.

The current runtime supports these built-in adapter ids:

- `svetserialu`
- `bombuj`
- `synova`

Repository manifests can add or override provider module metadata. Runtime
fetch/search behavior still needs a matching adapter in the app/server bundle.
