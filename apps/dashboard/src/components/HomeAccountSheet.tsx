import { Check, LoaderCircle, LogOut, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  connectPrivateNodeWithCode,
  fetchPrivateNodeAccountsViaGateway,
  fetchPrivateNodeStatusViaGateway,
  loginWatcherViaGateway,
  logoutPrivateNode,
  writePrivateNodeConnection,
  type PrivateNodeConnection,
} from "../lib/private-node-client";
import { resolvePrivateGatewayCandidateByNetworkName } from "../lib/v2-gateway-client";
import { parsePrivateNodeLoginName } from "../../../../packages/node-protocol/src";

type HomeAccountSheetProps = {
  open: boolean;
  connection: PrivateNodeConnection;
  onClose: () => void;
  onOpenSettings: () => void;
};

const GATEWAY_TIMEOUT_MS = 20_000;
const FALLBACK_SERVER_NAME = "kao-home";

export function HomeAccountSheet({ open, connection, onClose, onOpenSettings }: HomeAccountSheetProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setUsername("");
    setPassword("");
    setMessage(null);
  }, [open ]);

  // onClose is an inline closure in the parent and changes identity on every
  // render (including the home hero rotation ticks). Route it through a ref so
  // this effect only runs when the sheet actually opens — otherwise the focus
  // timer below yanks the cursor back to the first field every few seconds.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current >= focusable.length - 1 ? 0 : current + 1);
      event.preventDefault();
      focusable[next].focus();
    };
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("input")?.focus(), 0);
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open ]);

  function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
    let timer: number | undefined;
    const guarded = (async () => {
      try {
        return await Promise.race([
          work,
          new Promise<never>((_resolve, reject) => {
            timer = window.setTimeout(() => reject(new Error(message)), ms);
          }),
        ]);
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
      }
    })();
    guarded.catch(() => undefined);
    return guarded;
  }

  function accountMatchesUsername(account: { accountId: string; watcherId?: string }, username: string) {
    const candidates = [account.accountId, account.watcherId]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => [value, value.replace(/^(?:watcher|acct)_/, "")]);
    return candidates.some((value) => value.toLowerCase() === username);
  }

  async function enter() {
    const name = username.trim().toLowerCase();
    if (!name) {
      setMessage("Enter your username.");
      return;
    }
    if (!password) {
      setMessage("Enter your password.");
      return;
    }
    // kao, kao.kao-home style, or an email-style watcher name. The server is
    // yours and stays implicit; the gateway locates it so there is no hunt.
    const serverName = connection.networkName ?? FALLBACK_SERVER_NAME;
    const login = name.includes(".") ? name : `${name}.${serverName}`;
    const direct = !name.includes("@") ? parsePrivateNodeLoginName(login) : null;
    const emailish = !direct && /^[a-z0-9](?:[a-z0-9@._-]{0,62}[a-z0-9])?$/.test(name) && name.includes("@")
      ? { username: name, networkName: serverName }
      : null;
    if (!direct && !emailish) {
      setMessage("Use your username — kao, or kao.kao-home style.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const resolved = direct
        ? await withTimeout(
          connectPrivateNodeWithCode(login),
          GATEWAY_TIMEOUT_MS,
          "The private-node connection service is taking too long. Try again in a moment.",
        )
        : await withTimeout((async () => {
          const candidate = await resolvePrivateGatewayCandidateByNetworkName(serverName);
          return {
            candidate,
            loginName: emailish!,
            connection: {
              nodeUrl: "",
              nodeId: candidate.nodeId,
              connectionCode: candidate.connectionCode ?? null,
              networkName: candidate.networkName ?? serverName,
              token: null,
              refreshToken: null,
              accountId: null,
              profileId: null,
              accountName: null,
              profileName: null,
            } satisfies PrivateNodeConnection,
          };
        })(),
        GATEWAY_TIMEOUT_MS,
        "The private-node connection service is taking too long. Try again in a moment.",
        );
      const [status, nextAccounts] = await withTimeout(
        Promise.all([
          fetchPrivateNodeStatusViaGateway(resolved.connection, resolved.candidate),
          fetchPrivateNodeAccountsViaGateway(resolved.connection, resolved.candidate),
        ]),
        GATEWAY_TIMEOUT_MS,
        "The private node did not answer within 20 seconds. It may be reconnecting; try again.",
      );
      if (!status.auth?.privateAuthEnabled) {
        throw new Error("This node has not finished private setup yet.");
      }
      const account = nextAccounts.find((entry) => accountMatchesUsername(entry, resolved.loginName!.username));
      if (!account) {
        throw new Error(`This server has no viewing account named "${resolved.loginName!.username}".`);
      }
      const result = await withTimeout(
        loginWatcherViaGateway({
          connection: resolved.connection,
          watcherId: account.accountId,
          password,
          candidate: resolved.candidate,
        }),
        GATEWAY_TIMEOUT_MS,
        "The server took too long to check the password. Try again.",
      );
      const nextProfileId = result.session.profileId ?? result.profiles[0]?.profileId ?? null;
      const nextProfile = result.profiles.find((profile) => profile.profileId === nextProfileId);
      writePrivateNodeConnection({
        ...resolved.connection,
        nodeUrl: resolved.candidate.endpointUrl ?? "",
        token: result.token,
        refreshToken: result.refreshToken ?? null,
        accountId: result.account.accountId,
        profileId: nextProfileId,
        accountName: result.account.displayName,
        profileName: nextProfile?.displayName ?? null,
      });
      setPassword("");
      setMessage(null);
      onCloseRef.current();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Sign-in failed.";
      setMessage(detail.includes("Invalid username or password")
        ? "That password was rejected. It is separate from Server Settings — set it on the server PC under Accounts."
        : detail);
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    writePrivateNodeConnection({ nodeUrl: connection.nodeUrl, token: null, refreshToken: null, accountId: null, profileId: null, accountName: null, profileName: null });
    setUsername("");
    setPassword("");
    setMessage("Signed out on this device.");
    void logoutPrivateNode(connection).catch(() => undefined);
  }

  if (!open) return null;
  const signedIn = Boolean(connection.token && connection.accountId);
  const initial = (connection.profileName || connection.accountName || "A").trim().charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Private cinema sign in" className="relative w-full max-w-xs overflow-hidden rounded-[28px] border border-white/15 bg-white/[0.07] p-6 text-white shadow-[0_32px_100px_rgba(0,0,0,.65),inset_0_1px_0_rgba(255,255,255,.12)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute -top-20 left-1/2 h-44 w-64 -translate-x-1/2 rounded-full bg-orange-400/20 blur-3xl" />
        <button type="button" onClick={() => onCloseRef.current()} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/55 transition hover:bg-white/12 hover:text-white focus-visible:outline-2" aria-label="Close sign in"><X className="h-4 w-4" /></button>

        {signedIn ? (
          <div className="relative">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-orange-200 to-orange-400 text-xl font-black text-black shadow-[0_0_36px_rgba(251,146,60,.35)]">{initial}</div>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-emerald-300"><Check className="h-3 w-3" /> Signed in</div>
            <p className="mt-1 truncate text-center text-base font-black">{connection.profileName || connection.accountName}</p>
            {connection.profileName && connection.accountName ? <p className="truncate text-center text-xs text-white/45">{connection.accountName}</p> : null}
            <button type="button" onClick={() => { onCloseRef.current(); onOpenSettings(); }} className="mt-4 min-h-11 w-full text-xs font-semibold text-white/50 transition hover:text-white">Manage in settings</button>
            <button type="button" onClick={signOut} className="mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-red-200 transition hover:bg-red-400/10 focus-visible:outline-2"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        ) : (
          <div className="relative">
            <h2 className="text-center text-[26px] font-black tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,.45)]">Log In</h2>
            <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (!busy) void enter(); }}>
              <div>
                <label className="sr-only" htmlFor="home-account-username">Username</label>
                <input id="home-account-username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" className="min-h-12 w-full rounded-2xl border border-white/40 bg-gradient-to-b from-white via-white to-white/75 px-4 text-sm font-semibold text-black shadow-[0_10px_28px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.9),inset_0_-1px_0_rgba(0,0,0,.08)] outline-none backdrop-blur-xl transition placeholder:text-black/40 focus:border-white/70 focus:ring-2 focus:ring-white/40" />
              </div>
              <div>
                <label className="sr-only" htmlFor="home-account-password">Password</label>
                <input id="home-account-password" type="password" autoComplete="current-password" enterKeyHint="go" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="min-h-12 w-full rounded-2xl border border-white/40 bg-gradient-to-b from-white via-white to-white/75 px-4 text-sm font-semibold text-black shadow-[0_10px_28px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.9),inset_0_-1px_0_rgba(0,0,0,.08)] outline-none backdrop-blur-xl transition placeholder:text-black/40 focus:border-white/70 focus:ring-2 focus:ring-white/40" />
              </div>
              <button type="submit" disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/50 bg-gradient-to-b from-white via-white to-white/70 text-sm font-black text-black shadow-[0_12px_32px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,1),inset_0_-2px_4px_rgba(0,0,0,.1)] backdrop-blur-xl transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{busy ? "Signing in…" : "Enter"}
              </button>
            </form>
            {message ? <p className="mt-3 rounded-2xl border border-amber-200/15 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100 backdrop-blur-sm" role="status">{message}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
