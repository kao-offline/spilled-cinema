import { proxyControlPlane } from "../_lib/control-plane-proxy.js";

export default async function handler(req, res) {
  return proxyControlPlane(req, res);
}
