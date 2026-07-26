import { v } from "convex/values";
import { internalMutation, query, type QueryCtx } from "./_generated/server";

async function requireOperator(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required.");
  }
  const role = await ctx.db
    .query("operatorRoles")
    .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!role?.enabled) {
    throw new Error("Operator access denied.");
  }
  return { identity, role };
}

export const getOperatorSession = query({
  args: {},
  handler: async (ctx) => {
    const { identity, role } = await requireOperator(ctx);
    return {
      tokenIdentifier: identity.tokenIdentifier,
      role: role.role,
    };
  },
});

export const setOperatorRole = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    role: v.union(v.literal("operator"), v.literal("security-admin")),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("operatorRoles")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, enabled: args.enabled, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("operatorRoles", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
