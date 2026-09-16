import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_BINDINGS,
  REMOTE_BINDINGS_STORAGE_KEY,
  bindingFromKeyboardEvent,
  displayRemoteBinding,
  readRemoteBindings,
  remoteActionForKeyboardEvent,
  writeRemoteBindings,
} from "../remote-bindings";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("remote bindings", () => {
  it("provides TV-friendly keyboard defaults", () => {
    const bindings = readRemoteBindings(memoryStorage());
    expect(remoteActionForKeyboardEvent({ key: "ArrowUp", code: "ArrowUp" }, bindings)).toBe("up");
    expect(remoteActionForKeyboardEvent({ key: "Enter", code: "Enter" }, bindings)).toBe("confirm");
    expect(remoteActionForKeyboardEvent({ key: " ", code: "Space" }, bindings)).toBe("playPause");
  });

  it("persists and restores a captured IR key", () => {
    const storage = memoryStorage();
    const bindings = readRemoteBindings(storage);
    bindings.confirm = bindingFromKeyboardEvent({ key: "Select", code: "" });
    writeRemoteBindings(bindings, storage);

    expect(readRemoteBindings(storage).confirm).toEqual({ key: "Select", code: "" });
    expect(remoteActionForKeyboardEvent({ key: "Select", code: "" }, readRemoteBindings(storage))).toBe("confirm");
  });

  it("falls back safely when storage contains malformed data", () => {
    const storage = memoryStorage({ [REMOTE_BINDINGS_STORAGE_KEY]: "not-json" });
    expect(readRemoteBindings(storage)).toEqual(DEFAULT_REMOTE_BINDINGS);
  });

  it("formats remote and keyboard labels", () => {
    expect(displayRemoteBinding({ key: "ArrowLeft", code: "ArrowLeft" })).toBe("Left");
    expect(displayRemoteBinding({ key: " ", code: "Space" })).toBe("Space");
    expect(displayRemoteBinding({ key: "AudioVolumeUp", code: "AudioVolumeUp" })).toBe("Volume Up");
  });
});
