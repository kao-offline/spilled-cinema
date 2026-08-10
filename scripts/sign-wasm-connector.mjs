import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

const artifactPath = resolve(process.argv[2] || "");
const metadataPath = resolve(process.argv[3] || "");
const outputPath = resolve(process.argv[4] || "signed-wasm-release.json");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node scripts/sign-wasm-connector.mjs <connector.wasm> <metadata.json> [output.json]");
}
const privateKeyText = process.env.SPILLED_PROVIDER_PUBLISHER_PRIVATE_KEY ||
  (process.env.SPILLED_PROVIDER_PUBLISHER_PRIVATE_KEY_FILE
    ? await readFile(resolve(process.env.SPILLED_PROVIDER_PUBLISHER_PRIVATE_KEY_FILE), "utf8")
    : "");
if (!privateKeyText) throw new Error("Provider publisher private key or key file is required.");
const bytes = await readFile(artifactPath);
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const unsigned = {
  providerId: metadata.providerId,
  version: metadata.version,
  artifactSha256: createHash("sha256").update(bytes).digest("hex"),
  publisherKeyId: metadata.publisherKeyId,
  allowedHosts: metadata.allowedHosts,
  allowedMethods: metadata.allowedMethods ?? ["GET"],
  maxResponseBytes: metadata.maxResponseBytes ?? 4 * 1024 * 1024,
  timeoutMs: metadata.timeoutMs ?? 20_000,
};
const signature = sign(null, Buffer.from(stable(unsigned)), createPrivateKey(privateKeyText)).toString("base64url");
await writeFile(outputPath, JSON.stringify({ ...unsigned, signature }, null, 2), { encoding: "utf8", mode: 0o600 });
console.log(`Signed WASM connector release written to ${outputPath}.`);
