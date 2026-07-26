import type { CapabilityTicketV2 } from "../../../packages/node-protocol/src";

export type OpaqueRpcFrame = {
  version: 2;
  requestId: string;
  ticketId: string;
  ticket?: CapabilityTicketV2;
  clientId?: string;
  body: string;
};

export function parseOpaqueRpcFrame(value: unknown, maxBytes: number): OpaqueRpcFrame {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error("Gateway frame exceeds its configured limit.");
  }
  const frame = JSON.parse(value) as Partial<OpaqueRpcFrame>;
  if (
    frame.version !== 2 ||
    typeof frame.requestId !== "string" ||
    typeof frame.ticketId !== "string" ||
    typeof frame.body !== "string" ||
    (frame.ticket !== undefined && (
      frame.ticket.version !== 2 ||
      frame.ticket.ticketId !== frame.ticketId ||
      typeof frame.ticket.maxRequestBytes !== "number" ||
      typeof frame.ticket.maxResponseBytes !== "number" ||
      typeof frame.ticket.maxDurationMs !== "number"
    )) ||
    (frame.clientId !== undefined && typeof frame.clientId !== "string")
  ) {
    throw new Error("Gateway frame is invalid.");
  }
  return frame as OpaqueRpcFrame;
}
