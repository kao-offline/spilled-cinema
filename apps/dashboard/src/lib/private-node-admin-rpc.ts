export type AdminGatewayRpc = {
  capability: "node.admin";
  action: string;
  method: string;
  params: Record<string, unknown>;
};

export function adminLoginRpc(adminId: string, password: string): AdminGatewayRpc {
  if (!adminId || !password) throw new Error("Admin id and password are required.");
  return { capability: "node.admin", action: "admin.login", method: "auth.admin.password.login", params: { adminId, password } };
}

function authenticatedAdminRpc(action: string, method: string, adminToken: string, params: Record<string, unknown> = {}): AdminGatewayRpc {
  if (!adminToken) throw new Error("Admin sign-in is required.");
  return { capability: "node.admin", action, method, params: { adminToken, ...params } };
}

export const adminStatusRpc = (token: string) => authenticatedAdminRpc("admin.status", "node.admin.status", token);
export const adminCapabilitiesRpc = (token: string, capabilities: Record<string, boolean>) => authenticatedAdminRpc("admin.capabilities", "node.admin.capabilities.update", token, { capabilities });
export const adminWatcherCreateRpc = (token: string, watcher: Record<string, unknown>) => authenticatedAdminRpc("admin.watcher.create", "node.admin.watcher.create", token, watcher);
