import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  libraries: defineTable({
    token: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_token", ["token"]),
  captureSessions: defineTable({
    libraryToken: v.string(),
    sourcePageUrl: v.string(),
    status: v.string(),
    createdAt: v.number(),
    lastError: v.optional(v.string()),
    capturePayload: v.optional(v.any()),
  })
    .index("by_library", ["libraryToken"])
    .index("by_library_created", ["libraryToken", "createdAt"]),
  mediaItems: defineTable({
    libraryToken: v.string(),
    title: v.string(),
    sourcePageUrl: v.string(),
    sourceHost: v.string(),
    posterUrl: v.optional(v.string()),
    primaryPlaybackUrl: v.string(),
    playbackKind: v.string(),
    subtitleTracks: v.array(v.any()),
    tags: v.array(v.string()),
    durationSeconds: v.optional(v.number()),
    resumePositionSeconds: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_library", ["libraryToken"])
    .index("by_library_created", ["libraryToken", "createdAt"])
    .index("by_library_source", ["libraryToken", "sourceHost"]),
});
