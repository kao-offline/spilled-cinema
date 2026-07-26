import type { AuthProvider } from "convex/server";

// Fail-closed development default. Run `npm run operator:configure-oidc`
// before deploying the operator console.
export const operatorAuthProviders: AuthProvider[] = [];
