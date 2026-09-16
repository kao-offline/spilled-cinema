import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const ACTIONS = ["up", "down", "left", "right", "confirm", "back", "home", "playPause", "fullscreen", "mute", "captions", "volumeUp", "volumeDown"] as const;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COMMAND_TTL_MS = 15 * 60 * 1000;

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sessionForSecret(ctx: any, sessionId: string, secret: string) {
  const session = await ctx.db.query("phoneRemoteSessions").withIndex("by_session_id", (q: any) => q.eq("sessionId", sessionId)).unique();
  if (!session || session.expiresAt <= Date.now() || session.secret !== secret) throw new Error("This phone remote session has expired.");
  return session;
}

export const create = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    const secret = randomToken();
    await ctx.db.insert("phoneRemoteSessions", { sessionId, secret, nextSequence: 0, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return { sessionId, secret, expiresAt: now + SESSION_TTL_MS };
  },
});

export const close = internalMutation({
  args: { sessionId: v.string(), secret: v.string() },
  handler: async (ctx, args) => {
    const session = await sessionForSecret(ctx, args.sessionId, args.secret);
    await ctx.db.delete(session._id);
    return { ok: true };
  },
});

export const command = internalMutation({
  args: { sessionId: v.string(), secret: v.string(), kind: v.union(v.literal("action"), v.literal("text"), v.literal("key")), action: v.optional(v.string()), text: v.optional(v.string()), key: v.optional(v.string()), code: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await sessionForSecret(ctx, args.sessionId, args.secret);
    if (args.kind === "action" && (!args.action || !ACTIONS.includes(args.action as typeof ACTIONS[number]))) throw new Error("Unknown remote action.");
    if (args.kind === "text" && (!args.text || args.text.length > 200)) throw new Error("Text must be 1-200 characters.");
    if (args.kind === "key" && (!args.key || args.key.length > 64 || (args.code && args.code.length > 64))) throw new Error("Invalid key.");
    const sequence = session.nextSequence + 1;
    const now = Date.now();
    await ctx.db.patch(session._id, { nextSequence: sequence });
    await ctx.db.insert("phoneRemoteCommands", { sessionId: args.sessionId, sequence, kind: args.kind, action: args.action, text: args.text, key: args.key, code: args.code, createdAt: now, expiresAt: Math.min(session.expiresAt, now + COMMAND_TTL_MS) });
    return { ok: true, sequence };
  },
});

export const poll = internalQuery({
  args: { sessionId: v.string(), secret: v.string(), after: v.number() },
  handler: async (ctx, args) => {
    const session = await sessionForSecret(ctx, args.sessionId, args.secret);
    const commands = await ctx.db.query("phoneRemoteCommands").withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", args.sessionId).gt("sequence", Math.max(0, Math.floor(args.after)))).take(25);
    return { cursor: session.nextSequence, commands: commands.filter((command) => command.expiresAt > Date.now()).map(({ sequence, kind, action, text, key, code, createdAt }) => ({ id: sequence, kind, action, text, key, code, at: createdAt })) };
  },
});
