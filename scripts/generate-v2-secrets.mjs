import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const providerPublisher = generateKeyPairSync("ed25519");
const providerPublisherKeyId = `provider-${randomUUID()}`;
const output = {
  controlPlaneKeyId: `control-${randomUUID()}`,
  controlPlanePrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  controlPlanePublicJwk: publicKey.export({ format: "jwk" }),
  controlPlaneAdminSecret: randomBytes(32).toString("base64url"),
  gatewayServiceToken: randomBytes(32).toString("base64url"),
  turnSharedSecret: randomBytes(32).toString("base64url"),
  providerPublisherKeyId,
  providerPublisherPrivateKey: providerPublisher.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  providerPublisherPublicKeys: {
    [providerPublisherKeyId]: providerPublisher.publicKey.export({ type: "spki", format: "pem" }).toString(),
  },
};
const target = resolve(process.argv[2] || "deployment-secrets.json");
await writeFile(target, JSON.stringify(output, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(`Created ${target}. Keep this file outside source control and copy it to an encrypted password manager.`);
