export const REMOTE_BINDINGS_STORAGE_KEY = "spilled.remote-bindings.v1";
export const REMOTE_BINDINGS_CHANGED_EVENT = "spilled:remote-bindings-changed";

export type RemoteAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "home"
  | "playPause"
  | "fullscreen"
  | "mute"
  | "captions"
  | "volumeUp"
  | "volumeDown";

export type RemoteBinding = {
  key: string;
  code: string;
};

export type RemoteBindings = Record<RemoteAction, RemoteBinding>;

export type RemoteActionDefinition = {
  action: RemoteAction;
  label: string;
  hint: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type KeyboardLike = Pick<KeyboardEvent, "key" | "code">;

export const REMOTE_ACTIONS: readonly RemoteActionDefinition[] = [
  { action: "up", label: "Up", hint: "Move focus up" },
  { action: "down", label: "Down", hint: "Move focus down" },
  { action: "left", label: "Left", hint: "Move left or rewind" },
  { action: "right", label: "Right", hint: "Move right or skip ahead" },
  { action: "confirm", label: "Select", hint: "Open the focused item" },
  { action: "back", label: "Back", hint: "Close the current layer" },
  { action: "home", label: "Home", hint: "Return to the cinema home" },
  { action: "playPause", label: "Play / pause", hint: "Toggle playback" },
  { action: "fullscreen", label: "Fullscreen", hint: "Toggle the player screen" },
  { action: "mute", label: "Mute", hint: "Toggle player audio" },
  { action: "captions", label: "Captions", hint: "Toggle subtitles" },
  { action: "volumeUp", label: "Volume up", hint: "Raise player volume" },
  { action: "volumeDown", label: "Volume down", hint: "Lower player volume" },
] as const;

export const DEFAULT_REMOTE_BINDINGS: RemoteBindings = {
  up: { key: "ArrowUp", code: "ArrowUp" },
  down: { key: "ArrowDown", code: "ArrowDown" },
  left: { key: "ArrowLeft", code: "ArrowLeft" },
  right: { key: "ArrowRight", code: "ArrowRight" },
  confirm: { key: "Enter", code: "Enter" },
  back: { key: "Escape", code: "Escape" },
  home: { key: "Home", code: "Home" },
  playPause: { key: " ", code: "Space" },
  fullscreen: { key: "f", code: "KeyF" },
  mute: { key: "m", code: "KeyM" },
  captions: { key: "c", code: "KeyC" },
  volumeUp: { key: "AudioVolumeUp", code: "AudioVolumeUp" },
  volumeDown: { key: "AudioVolumeDown", code: "AudioVolumeDown" },
};

export const CANONICAL_REMOTE_KEYS: Record<RemoteAction, RemoteBinding> = DEFAULT_REMOTE_BINDINGS;

function cloneDefaults(): RemoteBindings {
  return Object.fromEntries(
    Object.entries(DEFAULT_REMOTE_BINDINGS).map(([action, binding]) => [action, { ...binding }]),
  ) as RemoteBindings;
}

function isBinding(value: unknown): value is RemoteBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RemoteBinding>;
  return typeof candidate.key === "string"
    && typeof candidate.code === "string"
    && Boolean(candidate.key || candidate.code);
}

export function readRemoteBindings(storage?: StorageLike | null): RemoteBindings {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) return cloneDefaults();
  try {
    const parsed = JSON.parse(target.getItem(REMOTE_BINDINGS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    const defaults = cloneDefaults();
    for (const { action } of REMOTE_ACTIONS) {
      if (isBinding(parsed[action])) defaults[action] = { ...parsed[action] };
    }
    return defaults;
  } catch {
    return cloneDefaults();
  }
}

export function writeRemoteBindings(bindings: RemoteBindings, storage?: StorageLike | null) {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  target?.setItem(REMOTE_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
  if (!storage && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REMOTE_BINDINGS_CHANGED_EVENT));
  }
}

export function bindingFromKeyboardEvent(event: KeyboardLike): RemoteBinding {
  return { key: event.key, code: event.code };
}

export function bindingsMatch(left: RemoteBinding, right: RemoteBinding) {
  return Boolean((left.code && right.code && left.code === right.code)
    || (left.key && right.key && left.key === right.key));
}

export function remoteActionForKeyboardEvent(
  event: KeyboardLike,
  bindings: RemoteBindings = readRemoteBindings(),
): RemoteAction | null {
  const incoming = bindingFromKeyboardEvent(event);
  return REMOTE_ACTIONS.find(({ action }) => bindingsMatch(bindings[action], incoming))?.action ?? null;
}

export function displayRemoteBinding(binding: RemoteBinding) {
  if (binding.code === "Space" || binding.key === " ") return "Space";
  if (binding.key.startsWith("Arrow")) return binding.key.replace("Arrow", "");
  if (binding.key) return binding.key.replace(/^AudioVolume/, "Volume ");
  return binding.code || "Unbound";
}
