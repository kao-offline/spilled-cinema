import { describe, expect, it, vi } from "vitest";
import { createV2RpcExecutor } from "../../../../server/src/v2-rpc";

function executorFixture() {
  const runtime = {
    getStatus: vi.fn(async () => ({ status: "ok" })),
    listPrivateAccounts: vi.fn(async () => [{ accountId: "watcher" }]),
    loginWatcherPassword: vi.fn(async (input: unknown) => ({ token: "node-session", input })),
  };
  const execute = createV2RpcExecutor({} as never, {} as never, runtime as never);
  const call = (method: string, params: Record<string, unknown>, capability: "library.read" | "library.write") => execute({
    method,
    params,
    capability,
    principalKind: "private",
    ticketId: "ticket-private",
    limits: { maxResponseBytes: 1024 * 1024, maxDurationMs: 30_000 },
  });
  const verifierCall = (method: string, capability: "provider.search" | "player.resolve") => execute({
    method,
    params: {},
    capability,
    principalKind: "verifier",
    ticketId: "ticket-verifier",
    limits: { maxResponseBytes: 1024 * 1024, maxDurationMs: 30_000 },
  });
  return { runtime, call, verifierCall, execute };
}

describe("private node gateway RPC surface", () => {
  it("returns status and accounts without accepting a browser URL", async () => {
    const { call } = executorFixture();
    await expect(call("node.status", {}, "library.read")).resolves.toEqual({ status: "ok" });
    await expect(call("auth.accounts", {}, "library.read")).resolves.toEqual({
      accounts: [{ accountId: "watcher" }],
    });
  });

  it("passes password login to node-local authentication", async () => {
    const { runtime, call } = executorFixture();
    await expect(call("auth.watcher.password.login", {
      watcherId: "watcher",
      password: "not-sent-to-control-plane",
      profileId: "main",
    }, "library.write")).resolves.toMatchObject({ token: "node-session" });
    expect(runtime.loginWatcherPassword).toHaveBeenCalledWith({
      watcherId: "watcher",
      password: "not-sent-to-control-plane",
      profileId: "main",
    });
  });

  it("answers capability-scoped verifier probes without contacting an upstream provider", async () => {
    const { verifierCall, execute } = executorFixture();
    await expect(verifierCall("verifier.provider.search", "provider.search")).resolves.toEqual({
      ok: true,
      capability: "provider.search",
    });
    await expect(verifierCall("verifier.player.resolve", "player.resolve")).resolves.toEqual({
      ok: true,
      capability: "player.resolve",
    });
    await expect(execute({
      method: "verifier.player.resolve",
      params: {},
      capability: "player.resolve",
      principalKind: "public",
      ticketId: "ticket-public",
      limits: { maxResponseBytes: 1024, maxDurationMs: 1_000 },
    })).rejects.toThrow("not implemented");
  });
});
