import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { verifyPayload } from "../../../packages/security/src";

export type WasmConnectorManifest = {
  providerId: string;
  version: string;
  artifactSha256: string;
  publisherKeyId: string;
  allowedHosts: string[];
  allowedMethods: Array<"GET" | "POST">;
  maxResponseBytes: number;
  timeoutMs: number;
  signature: string;
};

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const module = await WebAssembly.compile(workerData.bytes);
  const imports = WebAssembly.Module.imports(module);
  if (imports.some((entry) => entry.module !== "spilled" || entry.name !== "abort")) {
    throw new Error("Connector imports an unsupported host capability.");
  }
  const instance = await WebAssembly.instantiate(module, { spilled: { abort: () => { throw new Error("Connector aborted."); } } });
  const memory = instance.exports.memory;
  const allocate = instance.exports.spilled_alloc;
  const run = instance.exports.spilled_run;
  if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== "function" || typeof run !== "function") {
    throw new Error("Connector does not implement the Spilled WASM ABI.");
  }
  const input = Buffer.from(JSON.stringify(workerData.input));
  const pointer = Number(allocate(input.length));
  new Uint8Array(memory.buffer, pointer, input.length).set(input);
  const packed = BigInt(run(pointer, input.length));
  const resultPointer = Number(packed >> 32n);
  const resultLength = Number(packed & 0xffffffffn);
  if (resultLength < 0 || resultLength > workerData.maxOutputBytes || resultPointer + resultLength > memory.buffer.byteLength) {
    throw new Error("Connector returned an invalid output range.");
  }
  const output = Buffer.from(memory.buffer, resultPointer, resultLength).toString("utf8");
  parentPort.postMessage({ ok: true, output });
})().catch((error) => parentPort.postMessage({ ok: false, error: error.message }));
`;

async function runWasm(bytes: Buffer, input: unknown, timeoutMs: number, maxOutputBytes: number) {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { bytes, input, maxOutputBytes },
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
  });
  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Connector exceeded its wall-clock limit."));
    }, timeoutMs);
    worker.once("message", (message: { ok?: boolean; output?: string; error?: string }) => {
      clearTimeout(timeout);
      void worker.terminate();
      if (!message.ok) reject(new Error(message.error || "Connector failed."));
      else {
        try {
          resolve(JSON.parse(message.output ?? "null"));
        } catch {
          reject(new Error("Connector returned invalid JSON."));
        }
      }
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function privateAddress(address: string) {
  const value = address.toLowerCase();
  if (value === "::1" || value === "::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1] ?? value;
  const octets = mapped.split(".").map(Number);
  if (octets.length !== 4 || octets.some((entry) => !Number.isInteger(entry))) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

async function brokerFetch(
  request: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown },
  manifest: WasmConnectorManifest,
) {
  if (typeof request.url !== "string") throw new Error("Connector fetch URL is missing.");
  const url = new URL(request.url);
  const method = typeof request.method === "string" ? request.method.toUpperCase() : "GET";
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port && url.port !== "443" ||
    !manifest.allowedHosts.includes(url.hostname.toLowerCase()) ||
    !manifest.allowedMethods.includes(method as "GET" | "POST")
  ) {
    throw new Error("Connector fetch request violates its signed network policy.");
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) {
    throw new Error("Connector fetch resolved to a private or reserved address.");
  }
  const response = await fetch(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(manifest.timeoutMs, 30_000)),
    headers: request.headers && typeof request.headers === "object"
      ? request.headers as Record<string, string>
      : undefined,
    body: method === "POST" && typeof request.body === "string" ? request.body : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > manifest.maxResponseBytes) throw new Error("Connector fetch response exceeds policy.");
  return {
    status: response.status,
    headers: Object.fromEntries([...response.headers].filter(([name]) =>
      ["content-type", "etag", "last-modified"].includes(name.toLowerCase())
    )),
    bodyBase64: bytes.toString("base64"),
  };
}

export class WasmConnectorSandbox {
  async execute(input: {
    bytes: Buffer;
    manifest: WasmConnectorManifest;
    publisherPublicKey: string;
    operation: string;
    payload: unknown;
    validateOutput: (value: unknown) => boolean;
  }) {
    const unsigned = { ...input.manifest, signature: undefined };
    delete unsigned.signature;
    if (
      createHash("sha256").update(input.bytes).digest("hex") !== input.manifest.artifactSha256 ||
      !verifyPayload(unsigned, input.manifest.signature, input.publisherPublicKey)
    ) {
      throw new Error("Connector release signature or artifact hash is invalid.");
    }
    let request: unknown = { operation: input.operation, payload: input.payload };
    for (let stage = 0; stage < 8; stage += 1) {
      const result = await runWasm(
        input.bytes,
        request,
        Math.min(Math.max(input.manifest.timeoutMs, 100), 30_000),
        Math.min(input.manifest.maxResponseBytes, 4 * 1024 * 1024),
      ) as { fetch?: unknown; output?: unknown; state?: unknown };
      if (result.fetch && typeof result.fetch === "object") {
        request = {
          operation: "fetchResult",
          state: result.state,
          response: await brokerFetch(result.fetch as never, input.manifest),
        };
        continue;
      }
      if (!input.validateOutput(result.output)) throw new Error("Connector output failed schema validation.");
      return result.output;
    }
    throw new Error("Connector exceeded its fetch-stage limit.");
  }
}
