import type { AuthConfig } from "convex/server";
import { operatorAuthProviders } from "./operatorAuth.generated";

export default {
  // Generic standards-based OIDC for the internal operator console. The
  // audience is mandatory; an issuer-only configuration would accept tokens
  // minted for another application. Customer identities remain node-owned.
  providers: operatorAuthProviders,
} satisfies AuthConfig;
