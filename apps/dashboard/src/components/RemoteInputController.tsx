import { useEffect, type ReactNode } from "react";
import {
  CANONICAL_REMOTE_KEYS,
  bindingsMatch,
  readRemoteBindings,
  remoteActionForKeyboardEvent,
} from "../lib/remote-bindings";

const MAPPED_EVENT_MARKER = "__spilledRemoteMapped";

type MarkedKeyboardEvent = KeyboardEvent & { [MAPPED_EVENT_MARKER]?: boolean };

export function RemoteInputController({ children }: { children: ReactNode }) {
  useEffect(() => {
    const translateRemoteKey = (event: KeyboardEvent) => {
      if ((event as MarkedKeyboardEvent)[MAPPED_EVENT_MARKER] || event.metaKey || event.ctrlKey || event.altKey) return;
      const action = remoteActionForKeyboardEvent(event, readRemoteBindings());
      if (!action) return;
      const canonical = CANONICAL_REMOTE_KEYS[action];
      if (bindingsMatch(canonical, { key: event.key, code: event.code })) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const mapped = new KeyboardEvent("keydown", {
        key: canonical.key,
        code: canonical.code,
        bubbles: true,
        cancelable: true,
        repeat: event.repeat,
      }) as MarkedKeyboardEvent;
      Object.defineProperty(mapped, MAPPED_EVENT_MARKER, { value: true });
      window.dispatchEvent(mapped);
    };

    window.addEventListener("keydown", translateRemoteKey, { capture: true });
    return () => window.removeEventListener("keydown", translateRemoteKey, { capture: true });
  }, []);

  return children;
}
