import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, QrCode, RefreshCw, RotateCcw, Satellite, Smartphone, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_REMOTE_BINDINGS,
  REMOTE_ACTIONS,
  bindingFromKeyboardEvent,
  bindingsMatch,
  displayRemoteBinding,
  readRemoteBindings,
  writeRemoteBindings,
  type RemoteAction,
  type RemoteBindings,
} from "../lib/remote-bindings";
import {
  buildHostedPhoneRemoteUrl,
  closeHostedPhoneRemoteSession,
  fetchRemoteInfo,
  readPhoneRemoteSession,
  startHostedPhoneRemoteSession,
  type PhoneRemoteSession,
  type RemoteInfo,
} from "../lib/phone-remote";
import { PhoneRemoteQr } from "./PhoneRemoteQr";

type RemoteBindingsModalProps = {
  open: boolean;
  onClose: () => void;
};

const DIRECTION_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
} as const;

function cloneBindings(bindings: RemoteBindings): RemoteBindings {
  return Object.fromEntries(Object.entries(bindings).map(([action, binding]) => [action, { ...binding }])) as RemoteBindings;
}

export function RemoteBindingsModal({ open, onClose }: RemoteBindingsModalProps) {
  const [draft, setDraft] = useState<RemoteBindings>(() => readRemoteBindings());
  const [listeningFor, setListeningFor] = useState<RemoteAction | null>(null);
  const [message, setMessage] = useState("Choose an action, then press a remote button.");
  const [remoteInfo, setRemoteInfo] = useState<RemoteInfo | null>(null);
  const [remoteInfoState, setRemoteInfoState] = useState<"idle" | "checking" | "ready" | "unavailable">("idle");
  const [phoneSession, setPhoneSession] = useState<PhoneRemoteSession | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);

  const refreshRemoteInfo = async () => {
    setRemoteInfoState("checking");
    const info = await fetchRemoteInfo();
    setRemoteInfo(info);
    setRemoteInfoState(info ? "ready" : "unavailable");
    setPhoneSession(readPhoneRemoteSession());
  };

  const handlePairPhone = async () => {
    setPairingBusy(true);
    const session = await startHostedPhoneRemoteSession();
    setPhoneSession(session);
    setMessage(session
      ? "Phone paired to this TV session. Scan the QR code to open the remote."
      : "Could not start the phone remote session. Try again.");
    setPairingBusy(false);
  };

  const handleUnpairPhone = async () => {
    await closeHostedPhoneRemoteSession();
    setPhoneSession(null);
    setMessage("Phone unpaired. The old QR code no longer works.");
  };

  useEffect(() => {
    if (!open) return;
    setDraft(readRemoteBindings());
    setListeningFor(null);
    setMessage("Choose an action, then press a remote button.");
    void refreshRemoteInfo();
  }, [open]);

  useEffect(() => {
    if (!open || !listeningFor) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) {
        setMessage("Press a button without a modifier key.");
        return;
      }
      const binding = bindingFromKeyboardEvent(event);
      const conflict = REMOTE_ACTIONS.find(({ action }) => action !== listeningFor && bindingsMatch(draft[action], binding));
      if (conflict) {
        setMessage(`${displayRemoteBinding(binding)} is already assigned to ${conflict.label}.`);
        return;
      }
      setDraft((current) => ({ ...current, [listeningFor]: binding }));
      const definition = REMOTE_ACTIONS.find(({ action }) => action === listeningFor);
      setMessage(`${definition?.label ?? listeningFor} bound to ${displayRemoteBinding(binding)}.`);
      setListeningFor(null);
    };
    window.addEventListener("keydown", capture, { capture: true });
    return () => window.removeEventListener("keydown", capture, { capture: true });
  }, [draft, listeningFor, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#030407]/84 px-4 py-6 backdrop-blur-2xl" onMouseDown={(event) => { event.stopPropagation(); onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-bindings-title"
        className="relative flex max-h-[min(760px,92vh)] w-full max-w-[720px] flex-col overflow-hidden rounded-[1.8rem] border border-white/12 bg-[#0a0c11] shadow-[0_40px_120px_rgba(0,0,0,.8)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_18%_0%,rgba(251,146,60,.18),transparent_48%),radial-gradient(circle_at_82%_0%,rgba(103,232,249,.12),transparent_45%)]" />
        <header className="relative flex items-start justify-between border-b border-white/8 px-6 py-5 sm:px-8">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-orange-300/70">
              <Satellite className="h-3.5 w-3.5" /> Input signal map
            </div>
            <h2 id="remote-bindings-title" className="text-2xl font-black tracking-[-0.035em] text-white">Remote button setup</h2>
            <p className="mt-1 max-w-lg text-sm leading-6 text-white/42">Point the remote at the TV, select a command, then press the physical button you want to use.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close remote setup" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/5 text-white/55 transition hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative overflow-y-auto px-4 py-4 sm:px-6">
          <section aria-label="Local IR receiver" className="mb-3 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[.03] px-4 py-3">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${remoteInfoState === "checking" ? "animate-pulse bg-amber-300" : remoteInfo?.receiver.reachable ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.8)]" : "bg-white/20"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-white/88">Local IR receiver</div>
              <div className="truncate text-[11px] text-white/38">
                {remoteInfoState === "checking" || remoteInfoState === "idle"
                  ? "Checking…"
                  : remoteInfoState === "unavailable"
                    ? "No local server — not needed. Direct IR and phone pairing work without one."
                    : remoteInfo?.receiver.reachable
                      ? `Connected on :${remoteInfo.receiver.port}${remoteInfo.receiver.latencyMs != null ? ` · ${remoteInfo.receiver.latencyMs}ms` : ""}`
                      : `Nothing on :${remoteInfo?.receiver.port ?? 8765} — only needed for the optional PC relay`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void refreshRemoteInfo()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/5 text-white/55 transition hover:bg-white/10 hover:text-white"
              aria-label="Recheck receiver and phone remote"
            >
              <RefreshCw className={`h-4 w-4 ${remoteInfoState === "checking" ? "animate-spin" : ""}`} />
            </button>
          </section>

          <section aria-label="Phone remote" className="mb-4 rounded-2xl border border-white/8 bg-white/[.03] px-4 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300/12 text-cyan-100">
                <Smartphone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white/88">Phone remote</div>
                <div className="text-[11px] text-white/38">D-pad plus a keyboard that types into the TV search box.</div>
              </div>
            </div>
            {!phoneSession ? (
              <div className="mt-3">
                <p className="mb-3 flex items-start gap-2 text-[11px] leading-5 text-white/45">
                  <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200/70" />
                  No server or shared Wi-Fi needed. The QR code pairs a phone to this TV session through a private link.
                </p>
                <button
                  type="button"
                  onClick={() => void handlePairPhone()}
                  disabled={pairingBusy}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-xs font-black text-black transition hover:bg-orange-100 disabled:opacity-50"
                >
                  <QrCode className="h-4 w-4" />
                  {pairingBusy ? "Pairing…" : "Pair this TV"}
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                <PhoneRemoteQr value={buildHostedPhoneRemoteUrl(phoneSession)} />
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <div className="break-all font-mono text-[11px] leading-5 text-cyan-100/80">{buildHostedPhoneRemoteUrl(phoneSession)}</div>
                  <p className="mt-2 text-[11px] leading-5 text-white/45">
                    Scan to open the remote. Focus the TV search box, then type on your phone — letters land where the cursor is.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleUnpairPhone()}
                    className="mt-2 h-9 rounded-full border border-white/10 px-4 text-[11px] font-bold text-white/55 transition hover:bg-white/8 hover:text-white"
                  >
                    Unpair phone
                  </button>
                </div>
              </div>
             )}
          </section>

          <div className="grid gap-2 sm:grid-cols-2">
            {REMOTE_ACTIONS.map(({ action, label, hint }) => {
              const Icon = action in DIRECTION_ICON ? DIRECTION_ICON[action as keyof typeof DIRECTION_ICON] : Keyboard;
              const active = listeningFor === action;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => {
                    setListeningFor(action);
                    setMessage(`Listening for ${label}… press a button now.`);
                  }}
                  className={`group flex min-h-[74px] items-center gap-3 rounded-2xl border px-3.5 text-left transition ${active ? "border-orange-300/55 bg-orange-300/12 ring-2 ring-orange-300/10" : "border-white/7 bg-white/[.035] hover:border-white/14 hover:bg-white/[.065]"}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? "bg-orange-300 text-black" : "bg-white/7 text-white/55 group-hover:text-white"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-white/88">{label}</span>
                    <span className="block truncate text-[11px] text-white/32">{hint}</span>
                  </span>
                  <kbd className={`max-w-28 truncate rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] ${active ? "border-orange-200/30 bg-black/20 text-orange-100" : "border-white/8 bg-black/25 text-white/48"}`}>
                    {active ? "Listening" : displayRemoteBinding(draft[action])}
                  </kbd>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="relative border-t border-white/8 bg-black/20 px-5 py-4 sm:px-7">
          <div className="mb-3 min-h-5 text-xs font-semibold text-cyan-100/58" aria-live="polite">{message}</div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => { setDraft(cloneBindings(DEFAULT_REMOTE_BINDINGS)); setListeningFor(null); setMessage("Default keyboard bindings restored in the draft."); }} className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-xs font-bold text-white/45 transition hover:bg-white/6 hover:text-white">
              <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="h-10 rounded-full border border-white/9 px-4 text-xs font-bold text-white/55 transition hover:bg-white/7 hover:text-white">Cancel</button>
              <button type="button" onClick={() => { writeRemoteBindings(draft); onClose(); }} className="h-10 rounded-full bg-white px-5 text-xs font-black text-black transition hover:bg-orange-100">Save bindings</button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
