import { describe, expect, it } from "vitest";
import {
  getRepositoryIntegrations,
  integrationToProviderModuleManifest,
  type LoadedProviderRepositoryManifest,
} from "./provider-repositories";

describe("provider repository manifests", () => {
  it("exposes v2 integrations and adapts them to legacy provider modules", () => {
    const loaded: LoadedProviderRepositoryManifest = {
      repositoryUrl: "https://github.com/example/spilled-connectors",
      manifestUrl: "https://raw.githubusercontent.com/example/spilled-connectors/main/spilled-connectors.json",
      manifest: {
        schemaVersion: 2,
        repositoryId: "example",
        repositoryName: "Example Integrations",
        updatedAt: "2026-06-05T00:00:00.000Z",
        integrations: [
          {
            id: "synova",
            displayName: "Synova",
            version: "2.0.0",
            status: "stable",
            runtime: {
              apiVersion: 2,
              entry: "connectors/synova.js",
            },
            capabilities: ["search", "discovery", "metadata", "import", "players", "noCredentials"],
          },
        ],
      },
    };

    const integrations = getRepositoryIntegrations(loaded);
    expect(integrations).toHaveLength(1);
    expect(integrations[0]).toMatchObject({
      id: "synova",
      repositoryUrl: loaded.repositoryUrl,
      capabilities: expect.arrayContaining(["search", "players", "noCredentials"]),
    });

    const module = integrationToProviderModuleManifest(integrations[0]);
    expect(module).toMatchObject({
      moduleId: "synova",
      displayName: "Synova",
      status: "active",
      capabilities: {
        import: true,
        player: true,
        search: true,
        download: false,
      },
    });
    expect(module.capabilities.feeds).toHaveLength(1);
  });
});
