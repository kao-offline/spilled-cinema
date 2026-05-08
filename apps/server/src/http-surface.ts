import type {
  AnonymousSessionGrant,
  PairingApproval,
  PairingRequest,
  PrivateSessionGrant,
  SpillshareSource,
} from "../../../packages/node-protocol/src";
import type { SpilledCinemaNodeRuntime } from "./runtime";

export type ServerStatusPayload = Awaited<ReturnType<SpilledCinemaNodeRuntime["getStatus"]>>;

export type ServerHttpSurface = {
  getStatus(): Promise<ServerStatusPayload>;
  createAnonymousGrant(input: {
    capability: "fetch" | "relay" | "stream" | "download" | "spillshare";
    contentId?: string;
    action?: string;
  }): Promise<AnonymousSessionGrant>;
  startPairing(deviceName: string): Promise<PairingRequest>;
  approvePairing(pairingId: string, code: string): Promise<PairingApproval>;
  issuePrivateGrant(input: {
    pairedDeviceId: string;
    capability: "library";
    contentId?: string;
    action?: string;
  }): Promise<PrivateSessionGrant>;
  findSpillshareSources(contentId: string): Promise<SpillshareSource[]>;
  getPasskeyRegistrationOptions(): Promise<Awaited<ReturnType<SpilledCinemaNodeRuntime["getPasskeyRegistrationChallenge"]>>>;
  getPasskeyAuthenticationOptions(): Promise<Awaited<ReturnType<SpilledCinemaNodeRuntime["getPasskeyAuthenticationChallenge"]>>>;
};

export function createServerHttpSurface(runtime: SpilledCinemaNodeRuntime): ServerHttpSurface {
  return {
    getStatus: () => runtime.getStatus(),
    createAnonymousGrant: (input) => runtime.createAnonymousGrant(input),
    startPairing: (deviceName) => runtime.startPairing(deviceName),
    approvePairing: (pairingId, code) => runtime.approvePairing(pairingId, code),
    issuePrivateGrant: (input) => runtime.issuePrivateGrant(input.pairedDeviceId, input),
    findSpillshareSources: (contentId) => runtime.findSpillshareSources(contentId),
    getPasskeyRegistrationOptions: () => runtime.getPasskeyRegistrationChallenge(),
    getPasskeyAuthenticationOptions: () => runtime.getPasskeyAuthenticationChallenge(),
  };
}
