import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WasmConnectorSandbox } from "../../../../node/src/wasm-connector";
import { signPayload } from "../../../../../packages/security/src";

describe("WASM connector sandbox", () => {
  it("rejects an artifact before execution when its publisher signature is invalid", async () => {
    const keys = generateKeyPairSync("ed25519");
    const bytes = Buffer.from("not-wasm");
    const manifest = {
      providerId: "test",
      version: "2.0.0",
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
      publisherKeyId: "publisher-test",
      allowedHosts: ["example.com"],
      allowedMethods: ["GET" as const],
      maxResponseBytes: 1024,
      timeoutMs: 1000,
      signature: "invalid",
    };
    await expect(new WasmConnectorSandbox().execute({
      bytes,
      manifest,
      publisherPublicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      operation: "search",
      payload: {},
      validateOutput: () => true,
    })).rejects.toThrow(/signature or artifact hash/i);
  });

  it("verifies signed metadata before compiling the isolated artifact", async () => {
    const keys = generateKeyPairSync("ed25519");
    const bytes = Buffer.from("not-wasm");
    const unsigned = {
      providerId: "test",
      version: "2.0.0",
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
      publisherKeyId: "publisher-test",
      allowedHosts: ["example.com"],
      allowedMethods: ["GET" as const],
      maxResponseBytes: 1024,
      timeoutMs: 1000,
    };
    await expect(new WasmConnectorSandbox().execute({
      bytes,
      manifest: {
        ...unsigned,
        signature: signPayload(unsigned, keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
      },
      publisherPublicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      operation: "search",
      payload: {},
      validateOutput: () => true,
    })).rejects.toThrow();
  });
});
