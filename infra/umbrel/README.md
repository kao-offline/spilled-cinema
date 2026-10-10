# SpilledCinema on Umbrel

Jellyfin is the native client. The SpilledCinema channel provides provider feeds, imported movie/series folders, player selection, on-demand resolution, subtitles and Jellyfin watch history. Its menu page adds provider search, metadata imports, refresh and administrator download management. Imports store metadata; playback does not save a whole media file. Completed downloads share one named media volume with Jellyfin's read-only local library.

Authentik supplies Jellyfin usernames/passwords through the official LDAP plugin. The internal LDAP outpost uses TLS with a matching hostname and a trusted certificate. This works with ordinary Jellyfin clients; it does not implement an OIDC browser redirect. Jellyfin retains a separate local recovery administrator.

## Runtime and persistence

Install the official Portainer Umbrel app. Its Docker environment requires **named volumes**, because bind-mounted data can disappear on app updates. `compose.yml` describes the deployed services and the existing named volumes. Portainer itself occupies port 9000; Authentik uses 19000 and Jellyfin 8096. Node, Convex, Postgres and LDAP have no published host ports. No additional public tunnel, Redis, VM or dashboard image is required.

The CPU/RAM limits and bounded logs are in the compose file. Spilled downloads allow one active job, reserve 16 GiB free disk, cap the flat download library at 60 GiB and individual downloads at 8 GiB. Checks run during transfers and before publishing the completed file. The full-download limits are optional on other deployments. Private node account quotas are separate. Jellyfin trickplay and chapter image generation are disabled for the download library.

Compatible streams use signed, scoped, expiring Jellyfin playback URLs. Video and subtitles remain behind Jellyfin; the node port stays private. Tampered and expired links are rejected. The plugin probes codecs, marks a default audio track and uses advertised HLS bandwidth as a conservative bitrate estimate. Compatible MP4 uses direct playback; Jellyfin remuxes HLS with video/audio copy. Probing is limited to 32 MB and five seconds. Unsupported client codecs can still require conversion; the Jellyfin container is capped at two CPU cores. Use a Jellyfin public URL that all intended players can reach.

## Build and install

From the repository root, using the existing npm lockfile:

```sh
npm ci
npm run build -w @spilledcinema/server
node scripts/build-umbrel-runtime.mjs infra/umbrel/artifacts/server
docker build -t spilledcinema-umbrel:YOUR_REVISION infra/umbrel/artifacts/server
dotnet restore apps/jellyfin-plugin/tests/SpilledCinema.Checks.csproj --source https://api.nuget.org/v3/index.json
dotnet run --project apps/jellyfin-plugin/tests/SpilledCinema.Checks.csproj -c Release --no-restore
```

Build the plugin with .NET 10. Stop **only** the target Jellyfin container before replacing its loaded plugin assemblies. Copy `Jellyfin.Plugin.SpilledCinema.dll` into `/config/plugins/SpilledCinema_1.0.0.0/` using Portainer's container archive API, then start that container. Install official LDAP Authentication v24 the same way, preserving its bundled dependencies and manifest. Run Jellyfin's Refresh Channels task once after initial installation.

Configure the plugin's internal node URL (`http://spilled-node:8787`), public Jellyfin URL, preferred language and download setting. Create an Authentik LDAP application, outpost, restricted search service account and Jellyfin user/admin groups. Configure the LDAP plugin for outpost TLS port **6636**, its bind account, Base DN, group filters, and the trusted certificate file in the Jellyfin config volume. Keep certificate validation enabled. Configure the local Jellyfin library for `/media` with heavy image extraction disabled.

`env.example` contains placeholders only. Keep actual credentials outside Git and restrict access. `compose.yml` is a recovery specification: do not deploy it over the existing individually created containers without first arranging a target-only maintenance window and retaining their volumes. It intentionally requires existing volumes and network so a missing data volume cannot silently create an empty replacement.

## Parallel migration and recovery

1. Keep Windows services and their existing public routing running. Inventory source tasks, databases, media and credential references.
2. Use SQLite `VACUUM INTO` to make consistent online node/Convex snapshots. Check `PRAGMA integrity_check`, archive only required storage files and verify the transfer SHA-256 at both ends. Do not use a source backup script that stops the backend.
3. Seed the target named volumes. Preserve original snapshots. On the **node copy only**, clear identity/configuration and session/device enrollment tables, retaining accounts, profiles and provider state. Create a new Linux master key as 64 hex characters with mode 0600. Windows DPAPI identity material cannot be reused on Linux. A parallel node needs its own identity.
4. Preserve the Convex instance secret with its database. Keep its copied backend private; do not reuse the source tunnel token or point hosted traffic at two independent database copies. Adjust target storage paths/quotas and copy only needed provider credentials through private channels.
5. Verify health, native browsing/import, both user/admin Authentik login, range/HLS playback, downloads, resource usage and restart persistence. Switch intended clients to Jellyfin after these pass.

Rollback stops only the new Umbrel containers. Leave all named volumes intact and continue using the unchanged Windows deployment. Restore a damaged target database into a **new named volume** from the verified snapshot, verify integrity again, and remount that volume. Never restore over a running database, remove the source database, run `docker compose down -v`, or prune volumes as part of routine cleanup. Back up the target node, Convex, Jellyfin config, Authentik database/data, signing key and protected recovery credentials before future updates. Keep generated cache separate from persistent metadata/media.

Validation commands: dashboard `test`, `lint`, `build`; server `build`; plugin console checks; real service smoke tests described above. Operational addresses, immutable deployed image IDs and verification evidence belong in the private migration release record, not in a committed secret file.
