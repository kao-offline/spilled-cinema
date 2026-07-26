import { Readable } from "node:stream";
import type { Capability } from "../../../packages/node-protocol/src";
import type { JsonResponse, RequestLike } from "./http-handlers";
import type { TransientDownloadScheduler } from "../../node/src/transient-downloads";
import type { SpilledCinemaNodeRuntime } from "../../node/src/runtime";
import { createFileTransferSource, type RelayOnlyBulkTransferManager } from "./bulk-webrtc";

type Handler = (req: RequestLike, res: JsonResponse) => void | Promise<void>;

type HandlerSet = {
  providerSearchHandler: Handler;
  providerFeedHandler: Handler;
  providerImportHandler: Handler;
  playbackResolveHandler: Handler;
  startDownloadHandler: Handler;
  downloadStatusHandler: Handler;
  cancelDownloadHandler: Handler;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function invokeJsonHandler(handler: Handler, method: string, params: unknown, query = "") {
  const body = method === "GET" ? "" : JSON.stringify(asRecord(params));
  const request = Readable.from(body ? [Buffer.from(body, "utf8")] : []) as RequestLike;
  request.method = method;
  request.url = `/${query ? `?${query}` : ""}`;
  request.headers = { "content-type": "application/json" };
  return await new Promise<unknown>((resolve, reject) => {
    let responseBody = "";
    const response: JsonResponse = {
      statusCode: 200,
      setHeader: () => undefined,
      end: (chunk) => {
        responseBody = chunk ?? "";
        let parsed: unknown = null;
        try {
          parsed = responseBody ? JSON.parse(responseBody) : null;
        } catch {
          reject(new Error("RPC handler returned a non-JSON response."));
          return;
        }
        if (response.statusCode >= 400) {
          const message = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error?: unknown }).error)
            : `RPC handler failed with ${response.statusCode}.`;
          reject(new Error(message));
          return;
        }
        resolve(parsed);
      },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

export function createV2RpcExecutor(
  handlers: HandlerSet,
  transientDownloads: TransientDownloadScheduler,
  runtime: SpilledCinemaNodeRuntime,
  bulkTransfers?: RelayOnlyBulkTransferManager,
) {
  return async (request: {
    method: string;
    params: unknown;
    capability: Capability;
    ticketId: string;
    limits: { maxResponseBytes: number; maxDurationMs: number };
  }) => {
    const params = asRecord(request.params);
    switch (request.method) {
      case "provider.search":
        return await invokeJsonHandler(handlers.providerSearchHandler, "POST", params);
      case "provider.feed":
        return await invokeJsonHandler(handlers.providerFeedHandler, "POST", params);
      case "provider.import":
        return await invokeJsonHandler(handlers.providerImportHandler, "POST", params);
      case "player.resolve":
        return await invokeJsonHandler(handlers.playbackResolveHandler, "POST", params);
      case "download.transient.create":
        if (typeof params.sourceUrl !== "string") throw new Error("sourceUrl is required.");
        return {
          job: await transientDownloads.create(
            params.sourceUrl,
            request.limits.maxResponseBytes,
            request.limits.maxDurationMs,
          ),
        };
      case "download.transient.status": {
        const jobId = typeof params.jobId === "string" ? params.jobId : "";
        if (!jobId) throw new Error("jobId is required.");
        const job = transientDownloads.get(jobId);
        if (!job) throw new Error("Transient job not found.");
        return { job };
      }
      case "download.transient.cancel":
        if (typeof params.jobId !== "string") throw new Error("jobId is required.");
        return { job: transientDownloads.cancel(params.jobId) };
      case "download.transient.prepare":
      case "relay.stream": {
        if (!bulkTransfers) throw new Error("Bulk transfer runtime is unavailable.");
        if (
          typeof params.jobId !== "string" ||
          typeof params.offerSdp !== "string" ||
          !params.turn ||
          typeof params.turn !== "object"
        ) {
          throw new Error("jobId, offerSdp, and TURN credentials are required.");
        }
        const outputPath = transientDownloads.getOutputPath(params.jobId);
        if (!outputPath) throw new Error("Transient output is not ready.");
        transientDownloads.markStreaming(params.jobId);
        const source = await createFileTransferSource(outputPath, `transient:${params.jobId}`);
        source.onComplete = () => { transientDownloads.complete(params.jobId as string); };
        return {
          manifest: {
            manifestId: source.manifestId,
            contentId: source.contentId,
            chunks: source.chunks,
          },
          transport: await bulkTransfers.prepare({
            ticketId: request.ticketId,
            offerSdp: params.offerSdp,
            remoteCandidates: Array.isArray(params.remoteCandidates)
              ? params.remoteCandidates as Array<{ candidate: string; mid: string }>
              : [],
            turn: params.turn as never,
            source,
          }),
        };
      }
      case "spillshare.manifest":
        if (typeof params.contentId !== "string") throw new Error("contentId is required.");
        return { manifest: await runtime.createSpillshareManifest(params.contentId) };
      case "spillshare.transfer.prepare": {
        if (!bulkTransfers) throw new Error("Bulk transfer runtime is unavailable.");
        if (
          typeof params.contentId !== "string" ||
          typeof params.offerSdp !== "string" ||
          !params.turn ||
          typeof params.turn !== "object"
        ) {
          throw new Error("contentId, offerSdp, and TURN credentials are required.");
        }
        const source = await runtime.getSpillshareTransferSource(params.contentId);
        return {
          manifest: source.manifest,
          transport: await bulkTransfers.prepare({
            ticketId: request.ticketId,
            offerSdp: params.offerSdp,
            remoteCandidates: Array.isArray(params.remoteCandidates)
              ? params.remoteCandidates as Array<{ candidate: string; mid: string }>
              : [],
            turn: params.turn as {
              urls: string[];
              username: string;
              credential: string;
              iceTransportPolicy: "relay";
              expiresAt: number;
            },
            source,
          }),
        };
      }
      case "auth.refresh":
        if (typeof params.refreshToken !== "string") throw new Error("refreshToken is required.");
        return await runtime.rotateRefreshSession(params.refreshToken);
      case "auth.passkey.options":
        if (typeof params.accountId !== "string" || typeof params.origin !== "string") {
          throw new Error("accountId and origin are required.");
        }
        if (params.flow === "registration") {
          if (typeof params.setupSecret !== "string") throw new Error("setupSecret is required.");
          return await runtime.createPasskeyRegistrationOptions({
            accountId: params.accountId,
            setupSecret: params.setupSecret,
            origin: params.origin,
          });
        }
        return await runtime.createPasskeyLoginOptions({
          accountId: params.accountId,
          origin: params.origin,
        });
      case "auth.passkey.verify":
        if (
          typeof params.accountId !== "string" ||
          typeof params.origin !== "string" ||
          !params.response ||
          typeof params.response !== "object"
        ) {
          throw new Error("accountId, origin, and response are required.");
        }
        if (params.flow === "registration") {
          return await runtime.verifyPasskeyRegistration({
            accountId: params.accountId,
            origin: params.origin,
            response: params.response as never,
          });
        }
        return await runtime.verifyPasskeyLogin({
          accountId: params.accountId,
          origin: params.origin,
          response: params.response as never,
          profileId: typeof params.profileId === "string" ? params.profileId : undefined,
        });
      case "auth.logout":
        if (typeof params.accessToken !== "string") throw new Error("accessToken is required.");
        if (params.principalKind === "admin") {
          return await runtime.logoutAdminSession(params.accessToken);
        }
        return await runtime.logoutPrivateSession(params.accessToken);
      case "auth.password.disable":
        if (typeof params.adminToken !== "string") throw new Error("adminToken is required.");
        return await runtime.disableAdminPassword(params.adminToken);
      case "invite.inspect":
        if (typeof params.invitationSecret !== "string" || typeof params.confirmationCode !== "string") {
          throw new Error("invitationSecret and confirmationCode are required.");
        }
        return await runtime.inspectWatcherInvitation({
          invitationSecret: params.invitationSecret,
          confirmationCode: params.confirmationCode,
        });
      case "invite.accept":
        if (
          typeof params.watcherId !== "string" ||
          typeof params.invitationSecret !== "string" ||
          typeof params.origin !== "string"
        ) {
          throw new Error("watcherId, invitationSecret, and origin are required.");
        }
        return await runtime.createPasskeyRegistrationOptions({
          accountId: params.watcherId,
          setupSecret: params.invitationSecret,
          origin: params.origin,
        });
      case "recovery.export":
        if (typeof params.adminToken !== "string") throw new Error("adminToken is required.");
        return await runtime.exportRecoveryKit(params.adminToken);
      case "recovery.restore":
        if (typeof params.recoveryId !== "string" || typeof params.words !== "string") {
          throw new Error("recoveryId and words are required.");
        }
        return await runtime.restoreRecoveryKit({
          recoveryId: params.recoveryId,
          words: params.words,
        });
      default:
        throw new Error(`Remote RPC method "${request.method}" is not implemented.`);
    }
  };
}
