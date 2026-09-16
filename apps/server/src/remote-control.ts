import { networkInterfaces } from "node:os";
import { randomUUID, timingSafeEqual } from "node:crypto";

// Phone-as-remote + IR receiver status for the Spilled Server.
//
// The Python IR prototype (testing/ir-remote-prototype) injects OS keys on
// the PC directly, so the dashboard never sees it — the server can only
// report whether its /health endpoint answers on loopback.
//
// Phones take a different path: the server serves a /remote D-pad page on
// the LAN and queues validated commands; the dashboard polls the queue
// through the normal runtime cascade and replays them as key/text input.
// A pairing token (shown as a QR code in the dashboard) keeps random LAN
// neighbors from pressing keys on your TV.

export const REMOTE_ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "home",
  "playPause",
  "fullscreen",
  "mute",
  "captions",
  "volumeUp",
  "volumeDown",
] as const;

export type RemoteActionName = (typeof REMOTE_ACTIONS)[number];

export type RemoteCommandKind = "action" | "text" | "key";

export type RemoteCommand = {
  id: number;
  kind: RemoteCommandKind;
  action?: RemoteActionName;
  text?: string;
  key?: string;
  code?: string;
  at: number;
};

export type RemoteReceiverStatus = {
  port: number;
  reachable: boolean;
  latencyMs: number | null;
};

const MAX_QUEUE = 100;
const MAX_POLL_COMMANDS = 25;
const RECEIVER_TIMEOUT_MS = 1500;

let pairingToken: string | null = null;
let cursor = 0;
const queue: RemoteCommand[] = [];

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issuePairingToken(fresh = false) {
  if (!pairingToken || fresh) {
    pairingToken = randomUUID().replace(/-/g, "");
  }
  return pairingToken;
}

export function revokePairingToken() {
  pairingToken = null;
}

export function isPairedToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && pairingToken !== null && safeEqual(token, pairingToken);
}

function isValidAction(value: unknown): value is RemoteActionName {
  return typeof value === "string" && (REMOTE_ACTIONS as readonly string[]).includes(value);
}

export class RemoteCommandError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function enqueueRemoteCommand(input: {
  token?: unknown;
  kind?: unknown;
  action?: unknown;
  text?: unknown;
  key?: unknown;
  code?: unknown;
}): RemoteCommand {
  if (!isPairedToken(input.token)) {
    throw new RemoteCommandError("Pair this phone from the dashboard first.", 401);
  }
  if (input.kind !== "action" && input.kind !== "text" && input.kind !== "key") {
    throw new RemoteCommandError("Command kind must be action, text, or key.");
  }
  const command: RemoteCommand = { id: 0, kind: input.kind, at: Date.now() };
  if (input.kind === "action") {
    if (!isValidAction(input.action)) {
      throw new RemoteCommandError("Unknown remote action.");
    }
    command.action = input.action;
  } else if (input.kind === "text") {
    if (typeof input.text !== "string" || input.text.length === 0 || input.text.length > 200) {
      throw new RemoteCommandError("Text must be 1-200 characters.");
    }
    command.text = input.text;
  } else {
    if (typeof input.key !== "string" || input.key.length === 0 || input.key.length > 64) {
      throw new RemoteCommandError("Key must be 1-64 characters.");
    }
    command.key = input.key;
    if (typeof input.code === "string" && input.code.length > 0 && input.code.length <= 64) {
      command.code = input.code;
    }
  }
  cursor += 1;
  command.id = cursor;
  queue.push(command);
  while (queue.length > MAX_QUEUE) queue.shift();
  return command;
}

export function readRemoteCommands(after: number, limit = MAX_POLL_COMMANDS) {
  const from = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
  return { cursor, commands: queue.filter((entry) => entry.id > from).slice(0, Math.max(1, Math.min(limit, MAX_POLL_COMMANDS))) };
}

export function remoteReceiverPort() {
  const raw = Number.parseInt(process.env.SPILLED_REMOTE_RECEIVER_PORT ?? "", 10);
  return Number.isFinite(raw) && raw > 0 && raw < 65536 ? raw : 8765;
}

export async function probeRemoteReceiver(): Promise<RemoteReceiverStatus> {
  const port = remoteReceiverPort();
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RECEIVER_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
      if (!response.ok) return { port, reachable: false, latencyMs: null };
      return { port, reachable: true, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { port, reachable: false, latencyMs: null };
  }
}

export function serverLanIp() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return "";
}

export function serverPort() {
  const raw = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isFinite(raw) && raw > 0 && raw < 65536 ? raw : 8787;
}

/**
 * The tunnel monitor writes this after it has established a public endpoint.
 * Prefer it for phone pairing: unlike a LAN address it works from mobile data
 * or another Wi-Fi, while the pairing token still keeps the session private.
 */
export function publicRemoteUrl() {
  const endpoint = process.env.SPILLED_NODE_ENDPOINT_URL?.trim().replace(/\/$/, "");
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" ? new URL("/remote", url).toString() : "";
  } catch {
    return "";
  }
}

export function isLanReachable() {
  const host = (process.env.HOST ?? "127.0.0.1").trim().toLowerCase();
  return host !== "" && host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]";
}

// Phone remote page. Vanilla JS + inline CSS on purpose: no build step,
// works from any LAN browser. Token arrives via ?token= and is echoed into
// API calls; nothing is stored on the phone.
export function renderPhoneRemotePage(token: string) {
  const safeToken = token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#05070b" />
<title>Spilled Remote</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; min-height: 100dvh; background: #05070b; color: #fff; font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; padding: calc(1rem + env(safe-area-inset-top)) 1rem calc(1.5rem + env(safe-area-inset-bottom)); }
  h1 { font-size: 1rem; letter-spacing: .02em; margin: .25rem 0 0; }
  #status { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: rgba(255,255,255,.4); margin: .35rem 0 1rem; }
  #status.ok { color: #6ee7b7; } #status.bad { color: #fca5a5; }
  .pad { display: grid; grid-template-columns: repeat(3, 4.6rem); gap: .6rem; margin-bottom: .9rem; }
  .row { display: flex; gap: .6rem; margin-bottom: .9rem; flex-wrap: wrap; justify-content: center; }
  button { border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.07); color: #fff; border-radius: 1.1rem; font-size: .85rem; font-weight: 800; min-width: 4.6rem; min-height: 3.4rem; padding: .6rem .9rem; touch-action: manipulation; user-select: none; }
  button:active { background: rgba(255,255,255,.2); transform: scale(.96); }
  .pad button { min-height: 4.6rem; font-size: 1.3rem; }
  #ok { background: #fff; color: #05070b; border-color: #fff; }
  .kbd { width: min(100%, 24rem); display: flex; gap: .5rem; }
  .kbd input { flex: 1; min-width: 0; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; border-radius: 1rem; font-size: 1rem; padding: .8rem 1rem; outline: none; }
  .kbd input:focus { border-color: rgba(103,232,249,.6); }
  .hint { max-width: 24rem; text-align: center; font-size: .75rem; line-height: 1.5; color: rgba(255,255,255,.42); margin-top: .5rem; }
</style>
</head>
<body>
  <h1>Spilled Remote</h1>
  <div id="status">connecting…</div>
  <div class="pad">
    <span></span><button data-action="up" aria-label="Up">▲</button><span></span>
    <button data-action="left" aria-label="Left">◀</button><button data-action="confirm" id="ok" aria-label="OK">OK</button><button data-action="right" aria-label="Right">▶</button>
    <span></span><button data-action="down" aria-label="Down">▼</button><span></span>
  </div>
  <div class="row">
    <button data-action="back">Back</button>
    <button data-action="home">Home</button>
    <button data-action="playPause">⏯</button>
  </div>
  <div class="row">
    <button data-action="volumeDown">−</button>
    <button data-action="volumeUp">+</button>
    <button data-action="mute">Mute</button>
    <button data-action="captions">CC</button>
  </div>
  <div class="kbd">
    <input id="text" type="text" placeholder="Type to search…" autocomplete="off" autocapitalize="off" enterkeyhint="go" />
    <button id="send" aria-label="Send text">⏎</button>
    <button id="bs" aria-label="Backspace">⌫</button>
  </div>
  <p class="hint">Type while the TV search box is focused. D-pad moves, OK selects, Back goes back.</p>
<script>
  const token = ${JSON.stringify(safeToken)};
  const status = document.getElementById('status');
  const field = document.getElementById('text');
  let lastValue = '';
  let lastOk = 0;
  function mark(ok) {
    if (ok) { lastOk = Date.now(); status.textContent = 'connected'; status.className = 'ok'; }
    else if (Date.now() - lastOk > 4000) { status.textContent = 'unreachable — same Wi-Fi?'; status.className = 'bad'; }
  }
  async function send(body) {
    try {
      const res = await fetch('/api/remote/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
      mark(res.ok);
    } catch { mark(false); }
  }
  document.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => send({ kind: 'action', action: btn.dataset.action }));
  });
  field.addEventListener('input', () => {
    const next = field.value;
    if (next.startsWith(lastValue) && next.length > lastValue.length) {
      send({ kind: 'text', text: next.slice(lastValue.length) });
    } else if (next.length < lastValue.length && lastValue.startsWith(next)) {
      for (let i = 0; i < lastValue.length - next.length; i++) send({ kind: 'key', key: 'Backspace', code: 'Backspace' });
    }
    lastValue = next;
  });
  document.getElementById('send').addEventListener('click', () => { send({ kind: 'key', key: 'Enter', code: 'Enter' }); });
  document.getElementById('bs').addEventListener('click', () => {
    send({ kind: 'key', key: 'Backspace', code: 'Backspace' });
    if (field.value.length > 0) { field.value = field.value.slice(0, -1); lastValue = field.value; }
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); send({ kind: 'key', key: 'Enter', code: 'Enter' }); }
  });
  setInterval(() => mark(Date.now() - lastOk < 4000), 2000);
</script>
</body>
</html>`;
}
