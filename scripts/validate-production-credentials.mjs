import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const required = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "SPILLED_CONTROL_PLANE_SECRET",
  "SPILLED_GATEWAY_SERVICE_TOKEN",
  "TURN_SHARED_SECRET",
  "SPILLED_OPERATOR_OIDC_ISSUER",
  "SPILLED_OPERATOR_OIDC_CLIENT_ID",
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing production credentials: ${missing.join(", ")}`);
await access(process.env.CSC_LINK, constants.R_OK);
const pfx = await readFile(process.env.CSC_LINK);
if (pfx.length < 1024) throw new Error("CSC_LINK does not look like a valid signing certificate bundle.");
if (!process.env.SPILLED_OPERATOR_OIDC_ISSUER.startsWith("https://")) {
  throw new Error("Operator OIDC issuer must use HTTPS.");
}
if (Buffer.from(process.env.TURN_SHARED_SECRET).length < 32) {
  throw new Error("TURN_SHARED_SECRET must contain at least 256 bits of entropy.");
}
console.log("Production credential presence and basic format checks passed.");
