import { beforeEach, describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({
  requestPrivateGateway: vi.fn(),
  resolvePrivateGatewayCandidate: vi.fn(),
}));

vi.mock("../../lib/v2-gateway-client", () => gateway);

import { clearPrivateNodeConnection, logoutPrivateNode, type PrivateNodeConnection } from "../../lib/private-node-client";

function connection(overrides: Partial<PrivateNodeConnection> = {}): PrivateNodeConnection {
  return {
    nodeUrl: "",
    nodeId: "node-test",
    connectionCode: "0000-0000-0000-0000",
    token: "access-test",
    refreshToken: "refresh-test",
    accountId: "watcher-test",
    profileId: "profile-test",
    accountName: "Watcher",
    profileName: "Profile",
    ...overrides,
  };
}

describe("private node logout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    gateway.requestPrivateGateway.mockReset();
    gateway.resolvePrivateGatewayCandidate.mockReset();
  });

  it("revokes a gateway session before local state is cleared", async () => {
    const candidate = { nodeId: "node-test", connectionCode: "0000-0000-0000-0000", online: true };
    gateway.resolvePrivateGatewayCandidate.mockResolvedValue(candidate);
    gateway.requestPrivateGateway.mockResolvedValue({ ok: true });

    await expect(logoutPrivateNode(connection())).resolves.toEqual({ ok: true });
    expect(gateway.requestPrivateGateway).toHaveBeenCalledWith(
      candidate,
      "library.read",
      "logout",
      "auth.logout",
      { accessToken: "access-test" },
    );
    expect(clearPrivateNodeConnection()).toMatchObject({ token: null, refreshToken: null });
  });

  it("revokes a direct-node session with its bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await logoutPrivateNode(connection({
      nodeId: null,
      connectionCode: null,
      nodeUrl: "http://127.0.0.1:8787",
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/node/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer access-test" }),
      }),
    );
  });
});
