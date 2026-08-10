import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);

export const markLegacyNodesUnverified = migrations.define({
  table: "nodes",
  batchSize: 50,
  migrateOne: (_ctx, node) => node.verificationStatus === undefined
    ? { verificationStatus: "legacy-unverified" as const }
    : {},
});

export const expireLegacySpillshare = migrations.define({
  table: "spillshareSources",
  batchSize: 50,
  migrateOne: () => ({ expiresAt: 0 }),
});

export const runAll = migrations.runner([
  internal.migrations.markLegacyNodesUnverified,
  internal.migrations.expireLegacySpillshare,
]);

export const run = migrations.runner();
