import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const nodeUrl = (process.env.SPILLED_LOCAL_NODE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const controlPlaneUrl = process.env.SPILLED_CONTROL_PLANE_URL?.replace(/\/$/, "");
const adminSecret = process.env.SPILLED_CONTROL_PLANE_SECRET;
if (!controlPlaneUrl || !adminSecret) {
  throw new Error("SPILLED_CONTROL_PLANE_URL and SPILLED_CONTROL_PLANE_SECRET are required.");
}
const identityResponse = await fetch(`${nodeUrl}/v2/node/identity`);
if (!identityResponse.ok) throw new Error(`Local node identity request failed with ${identityResponse.status}.`);
const identity = await identityResponse.json();
const enrollmentCredential = randomBytes(32).toString("base64url");
const advertisedCapabilities = (process.env.SPILLED_PUBLIC_CAPABILITIES || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const enrollmentResponse = await fetch(`${controlPlaneUrl}/v2/nodes/enroll`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Spilled-Control-Plane-Secret": adminSecret,
  },
  body: JSON.stringify({ ...identity, enrollmentCredential, advertisedCapabilities }),
});
if (!enrollmentResponse.ok) {
  throw new Error(`Node enrollment failed with ${enrollmentResponse.status}: ${await enrollmentResponse.text()}`);
}
const target = resolve(process.argv[2] || "node-enrollment.json");
await writeFile(target, JSON.stringify({
  nodeId: identity.nodeId,
  enrollmentCredential,
  enrolledAt: Date.now(),
}, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(`Enrolled ${identity.nodeId}. Credential saved to ${target}.`);
