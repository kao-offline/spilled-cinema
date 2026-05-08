# Convex Setup Notes

This repo is already structured for a Convex-backed version of SpilledCinema, but a live deployment and generated bindings require your Convex project credentials.

To finish the cloud-backed setup:

1. Run `npx convex dev`
2. Link this repo to your Convex project
3. Replace the temporary localStorage library layer with Convex queries/mutations in the client components
4. Point `capture-store` persistence at Convex tables instead of the in-memory map

The app currently works as a local MVP:
- anonymous library token in browser storage
- capture sessions kept in the running Next.js process
- saved media items stored locally per browser

The schema below matches the implementation plan and can be used as the source of truth when wiring the real backend.
