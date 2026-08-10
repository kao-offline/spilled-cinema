const TV_MODE_KEY = "spilled.tv-mode.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function availableStorage(storage?: StorageLike | null) {
  if (storage !== undefined) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function readTvMode(storage?: StorageLike | null) {
  try {
    return availableStorage(storage)?.getItem(TV_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeTvMode(enabled: boolean, storage?: StorageLike | null) {
  try {
    availableStorage(storage)?.setItem(TV_MODE_KEY, String(enabled));
  } catch {
    // TV mode stays available for this session when storage is unavailable.
  }
}

export function applyTvMode(enabled: boolean, root?: Pick<DOMTokenList, "toggle"> | null) {
  const classList = root ?? (typeof document === "undefined" ? null : document.documentElement.classList);
  classList?.toggle("tv-mode", enabled);
}
