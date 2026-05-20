import { describe, expect, it } from "vitest";
import { resolveDownloadByteRange } from "../../../../server/src/http-handlers";

describe("download serving ranges", () => {
  it("serves full files when no range is requested", () => {
    expect(resolveDownloadByteRange(1000, undefined)).toEqual({
      statusCode: 200,
      start: 0,
      end: 999,
      contentLength: 1000,
      contentRange: null,
    });
  });

  it("resolves explicit and suffix ranges", () => {
    expect(resolveDownloadByteRange(1000, "bytes=100-199")).toMatchObject({
      statusCode: 206,
      start: 100,
      end: 199,
      contentLength: 100,
      contentRange: "bytes 100-199/1000",
    });

    expect(resolveDownloadByteRange(1000, "bytes=-250")).toMatchObject({
      statusCode: 206,
      start: 750,
      end: 999,
      contentLength: 250,
      contentRange: "bytes 750-999/1000",
    });
  });

  it("rejects invalid ranges", () => {
    expect(resolveDownloadByteRange(1000, "items=0-1")).toBeNull();
    expect(resolveDownloadByteRange(1000, "bytes=999-1000")).toBeNull();
    expect(resolveDownloadByteRange(1000, "bytes=800-100")).toBeNull();
  });
});
