import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, RotateCcw, Satellite, X } from "lucide-react";
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

  useEffect(() => {
    if (!open) return;
    setDraft(readRemoteBindings());
    setListeningFor(null);
    setMessage("Choose an action, then press a remote button.");
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
