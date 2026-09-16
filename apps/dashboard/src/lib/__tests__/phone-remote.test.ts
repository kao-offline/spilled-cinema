import { describe, expect, it } from "vitest";
import { buildPhoneRemoteUrl, keyEventForRemoteAction } from "../phone-remote";

describe("phone remote", () => {
  it("replays the user's own key bindings for phone actions", () => {
    expect(keyEventForRemoteAction("up")).toEqual({ key: "ArrowUp", code: "ArrowUp" });
    expect(keyEventForRemoteAction("confirm")).toEqual({ key: "Enter", code: "Enter" });
    expect(keyEventForRemoteAction("back")).toEqual({ key: "Escape", code: "Escape" });
    expect(keyEventForRemoteAction("playPause")).toEqual({ key: " ", code: "Space" });
    expect(keyEventForRemoteAction("volumeUp")).toEqual({ key: "AudioVolumeUp", code: "AudioVolumeUp" });
  });

  it("builds a pairable phone URL with an encoded token", () => {
    expect(buildPhoneRemoteUrl({ remoteUrl: "http://192.168.1.5:8787/remote" }, "abc+123")).toBe(
      "http://192.168.1.5:8787/remote?token=abc%2B123",
    );
  });
});
