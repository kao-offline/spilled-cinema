import { Writable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import { describe, expect, it } from "vitest";
import { pipeUpstreamBody } from "../../../../server/src/http-handlers";

describe("upstream playback stream", () => {
  it("closes the response safely when the upstream disconnects", async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.error(new Error("upstream disconnected")); } });
    const response = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const closed = new Promise<void>((resolve) => response.once("close", resolve));
    pipeUpstreamBody(body, response);
    await closed;
    expect(response.destroyed).toBe(true);
  });
  it("preserves response bytes when streaming succeeds", async () => {
    const chunks: Buffer[] = [];
    const response = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } });
    const finished = new Promise<void>((resolve) => response.once("finish", resolve));
    pipeUpstreamBody(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }), response);
    await finished;
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
  });
});
