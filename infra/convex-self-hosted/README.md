# Spilled control plane: self-hosted Convex

The production control plane runs on the Windows 10 microservice host using the
official native Convex x64 binary. The database API is bound to localhost on
port 3210. HTTP actions are bound to localhost on port 3211 and exposed through
a named Cloudflare Tunnel, a VPC service, and the `spilled-control-plane`
Worker. No inbound router port is opened.

Pinned backend release: `precompiled-2026-07-29-b7c47d7`

Windows release ZIP SHA-256:
`3A594CD9C4E2BBF51D3F224479A03B559EC28E70471DA8B852152B38DEE9B1B5`

Persistent runtime root: `C:\ProgramData\SpilledCinema\Convex`

The `secrets` directory must grant access only to SYSTEM and Administrators.
The instance secret, admin key, and tunnel token must never be committed.

## Public and private endpoints

- Public HTTP actions: `https://spilled-control-plane.hrdykrystof.workers.dev`
- Private Convex API: `http://127.0.0.1:3210` on the Windows host
- Private HTTP actions: `http://127.0.0.1:3211` on the Windows host
- Edge liveness: `/health/live`
- End-to-end readiness: `/health/ready`

## Deployment through SSH

Forward the private API locally, load the admin key without printing it, and
run the current Convex CLI with `CONVEX_SELF_HOSTED_URL` and
`CONVEX_SELF_HOSTED_ADMIN_KEY`. Snapshot imports use `--replace-all` only after
an export has been verified and the destination is known to be the new
self-hosted instance.

## Recovery

The backend and tunnel are independent SYSTEM scheduled tasks with unlimited
runtime and restart-on-failure. Runtime logs rotate at 25 MB. A third task makes
a consistent cold backup every day at 04:15 and retains seven restore points.
The durable data, file storage, backups, and secrets live outside the
application install directory so an application update cannot remove them.

Keep the last hosted Convex snapshot and the previous Cloudflare Worker version
until the self-hosted deployment has passed sustained health verification.
