import {
  keyEventForRemoteAction,
  pollHostedPhoneRemote,
  readPhoneRemoteSession,
  type RemoteCommand,
} from "./phone-remote";

// The relay is edge-hosted; a short poll gives the D-pad a TV-like response
// without keeping a server connection open in the browser.
const POLL_MS = 90;
const RETRY_MS = 4000;

function focusedTextField() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (!active.disabled && !active.readOnly) return active;
  }
  return null;
}

function dispatchKey(key: string, code: string) {
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, composed: true });
  window.dispatchEvent(event);
  return event;
}

/** Synthetic keys perform no default action, so Enter/Backspace on a focused field need a manual equivalent. */
function applyControlKey(key: string, code: string) {
  if (key === "Backspace") {
    const field = focusedTextField();
    if (field) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      if (start === end && start > 0) {
        field.setRangeText("", start - 1, end, "end");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (start !== end) {
        field.setRangeText("", start, end, "end");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
  }
  const event = dispatchKey(key, code);
  if (!event.defaultPrevented && (key === "Enter")) {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && !active.disabled) {
      active.click();
    } else if (active instanceof HTMLAnchorElement && active.href) {
      active.click();
    }
  }
}

export function insertRemoteText(text: string) {
  const field = focusedTextField();
  if (field) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(text, start, end, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) {
    document.execCommand("insertText", false, text);
    return true;
  }
  return false;
}

export function applyRemoteCommand(command: RemoteCommand) {
  if (command.kind === "text" && command.text) {
    insertRemoteText(command.text);
    return;
  }
  if (command.kind === "action" && command.action) {
    const { key, code } = keyEventForRemoteAction(command.action);
    applyControlKey(key, code);
    return;
  }
  if (command.kind === "key" && command.key) {
    applyControlKey(command.key, command.code ?? command.key);
  }
}

/**
 * Polls the server queue and replays phone commands as local input. Idle
 * (no timers wasted on failures) until a token is paired; backs off while
 * the server is unreachable. Safe to start once per app lifetime.
 */
export function startPhoneRemoteClient() {
  let stopped = false;
  let cursor = 0;
  let timer: number | null = null;
  let inflight = false;

  const tick = async () => {
    if (stopped || inflight) return;
    const session = readPhoneRemoteSession();
    if (!session || document.hidden) {
      schedule(POLL_MS);
      return;
    }
    inflight = true;
    try {
      const result = await pollHostedPhoneRemote(session, cursor);
      if (!result) {
        schedule(RETRY_MS);
        return;
      }
      cursor = result.cursor;
      for (const command of result.commands) {
        try {
          applyRemoteCommand(command);
        } catch {
          // One bad command must never break the stream.
        }
      }
      schedule(POLL_MS);
    } finally {
      inflight = false;
    }
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => void tick(), delay);
  };

  const onVisibility = () => {
    if (!document.hidden) void tick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void tick();

  return () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
