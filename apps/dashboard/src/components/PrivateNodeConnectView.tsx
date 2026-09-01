import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, KeyRound, LoaderCircle, LocateFixed, LockKeyhole, LogOut, Server, WifiOff, X } from "lucide-react";
import {
  clearPrivateNodeConnection,
  connectPrivateNodeWithCode,
  fetchPrivateNodeAccountsViaGateway,
  fetchPrivateNodeStatusViaGateway,
  findPrivateNodeCandidates,
  loginPasskeyViaGateway,
  loginWatcherViaGateway,
  logoutPrivateNode,
  readPrivateNodeConnection,
  writePrivateNodeConnection,
  type PrivateNodeAccount,
  type PrivateNodeConnection,
} from "../lib/private-node-client";
import { normalizeNodeConnectionCode, parsePrivateNodeLoginName } from "../../../../packages/node-protocol/src";

type ConnectStep = "locate" | "login" | "connected";
const PRIVATE_NODE_BOOTSTRAP_TIMEOUT_MS = 20_000;

async function waitForPrivateNodeBootstrap<T>(work: Promise<T>) {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => reject(new Error(
          "The private node did not answer within 20 seconds. It may be reconnecting; press Connect securely to retry.",
        )), PRIVATE_NODE_BOOTSTRAP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function displayLocator(value: string) {
  if (value.includes(".")) return value.toLowerCase();
  const compact = value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 16);
  return compact.match(/.{1,4}/g)?.join("-") ?? compact;
}

function accountMatchesUsername(account: PrivateNodeAccount, username: string) {
  const candidates = [account.accountId, account.watcherId]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, value.replace(/^(?:watcher|acct)_/, "")]);
  return candidates.some((value) => value.toLowerCase() === username);
}

type PrivateNodeConnectViewProps = {
  embedded?: boolean;
  onClose?: () => void;
  onConnected?: (connection: PrivateNodeConnection) => void;
};

export function PrivateNodeConnectView({ embedded = false, onClose, onConnected }: PrivateNodeConnectViewProps = {}) {
  const saved = useMemo(() => readPrivateNodeConnection(), []);
  const queryCode = useMemo(() => new URLSearchParams(window.location.search).get("code") ?? "", []);
  const queryLogin = useMemo(() => new URLSearchParams(window.location.search).get("login") ?? "", []);
  const [step, setStep] = useState<ConnectStep>(saved.nodeId && saved.token ? "connected" : "locate");
  const [code, setCode] = useState(queryLogin || queryCode || saved.connectionCode || "");
  const [connection, setConnection] = useState<PrivateNodeConnection>(saved);
  const [accounts, setAccounts] = useState<PrivateNodeAccount[]>([]);
  const [accountId, setAccountId] = useState(saved.accountId ?? "");
  const [profileId, setProfileId] = useState(saved.profileId ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nodeOnline, setNodeOnline] = useState(Boolean(saved.nodeId));
  const [loginUsername, setLoginUsername] = useState<string | null>(null);

  const selectedAccount = accounts.find((account) => account.accountId === accountId);
  const selectedAccountHasPassword = Boolean(selectedAccount?.hasPassword);
  const selectedAccountHasPasskey = (selectedAccount?.passkeyCount ?? 0) > 0;

  useEffect(() => {
    if (!embedded) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [embedded, onClose]);

  useEffect(() => {
    if (queryCode && normalizeNodeConnectionCode(queryCode)) void connect(queryCode);
    else if (queryLogin && parsePrivateNodeLoginName(queryLogin)) void connect(queryLogin);
  }, [queryCode, queryLogin]);

  useEffect(() => {
    if (!queryCode && !queryLogin && saved.connectionCode && !saved.token) void connect(saved.connectionCode);
  }, []);

  async function connect(value = code) {
    setBusy(true);
    setMessage(null);
    try {
      const resolved = await connectPrivateNodeWithCode(value);
      const [status, nextAccounts] = await waitForPrivateNodeBootstrap(Promise.all([
        fetchPrivateNodeStatusViaGateway(resolved.connection, resolved.candidate),
        fetchPrivateNodeAccountsViaGateway(resolved.connection, resolved.candidate),
      ]));
      if (!status.auth?.privateAuthEnabled) throw new Error("This node has not finished private setup yet.");
      if (nextAccounts.length === 0) throw new Error("This node does not have a watcher account yet.");
      const requestedAccount = resolved.loginName
        ? nextAccounts.find((account) => accountMatchesUsername(account, resolved.loginName!.username))
        : undefined;
      if (resolved.loginName && !requestedAccount) {
        throw new Error(`This server has no viewing account named "${resolved.loginName.username}".`);
      }
      const firstAccount = requestedAccount
        ?? nextAccounts.find((account) => account.accountId === saved.accountId)
        ?? nextAccounts[0];
      const firstProfile = firstAccount.profiles.find((profile) => profile.profileId === saved.profileId) ?? firstAccount.profiles[0];
      setCode(resolved.loginName
        ? `${resolved.loginName.username}.${resolved.loginName.networkName}`
        : resolved.connection.connectionCode ?? value);
      setLoginUsername(resolved.loginName?.username ?? null);
      setConnection(resolved.connection);
      setAccounts(nextAccounts);
      setAccountId(firstAccount.accountId);
      setProfileId(firstProfile?.profileId ?? "");
      setNodeOnline(true);
      setStep("login");
    } catch (error) {
      setNodeOnline(false);
      setMessage(error instanceof Error ? error.message : "Could not find that private node.");
    } finally {
      setBusy(false);
    }
  }

  async function findThisDevice() {
    setFinding(true);
    setMessage(null);
    try {
      const candidates = await findPrivateNodeCandidates(saved.nodeUrl ? [saved.nodeUrl] : []);
      const candidate = candidates.find((entry) => entry.status.auth?.privateAuthEnabled) ?? candidates[0];
      const localCode = candidate?.status.node?.connectionCode;
      if (!localCode) {
        throw new Error(candidate
          ? "The local server is an older build. Update it once to enable connection codes."
          : "No Spilled Server is running on this device.");
      }
      setCode(localCode);
      await connect(localCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not find a local server.");
    } finally {
      setFinding(false);
    }
  }

  function persistLogin(result: {
    token: string;
    refreshToken: string;
    account: { accountId: string; displayName: string };
    profiles: Array<{ profileId: string; displayName: string }>;
    session: { profileId?: string | null };
  }) {
    const nextProfileId = result.session.profileId ?? profileId ?? result.profiles[0]?.profileId ?? null;
    const nextProfile = result.profiles.find((profile) => profile.profileId === nextProfileId);
    const next = writePrivateNodeConnection({
      ...connection,
      token: result.token,
      refreshToken: result.refreshToken,
      accountId: result.account.accountId,
      accountName: result.account.displayName,
      profileId: nextProfileId,
      profileName: nextProfile?.displayName ?? null,
    });
    setConnection(next);
    onConnected?.(next);
    setPassword("");
    setLoginUsername(null);
    setStep("connected");
  }

  async function passwordLogin() {
    if (!accountId || !password) {
      setMessage("Choose an account and enter its password.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      persistLogin(await loginWatcherViaGateway({ connection, watcherId: accountId, password, profileId }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Sign-in failed.";
      setMessage(detail.includes("Invalid username or password")
        ? "That viewing password was rejected. It is separate from Server Settings. On the server PC, open the tray → Open setup and settings → Accounts to set or reset it."
        : detail);
    } finally {
      setBusy(false);
    }
  }

  async function passkeyLogin() {
    if (!accountId) return;
    setBusy(true);
    setMessage(null);
    try {
      persistLogin(await loginPasskeyViaGateway({ connection, accountId, profileId }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Passkey sign-in was not completed.");
    } finally {
      setBusy(false);
    }
  }

  function chooseAccount(nextAccountId: string) {
    const account = accounts.find((entry) => entry.accountId === nextAccountId);
    setAccountId(nextAccountId);
    setProfileId(account?.profiles[0]?.profileId ?? "");
  }

  function handleLogout() {
    setMessage(null);
    const previousConnection = connection;
    const next = clearPrivateNodeConnection();
    setConnection(next);
    setAccounts([]);
    setAccountId("");
    setProfileId("");
    setPassword("");
    setLoginUsername(null);
    setNodeOnline(false);
    setStep("locate");
    setMessage("Logged out.");
    onConnected?.(next);
    void logoutPrivateNode(previousConnection).catch(() => undefined);
  }

  return (
    <main
      className={`text-[#f4efe6] ${embedded ? "fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/72 p-3 sm:p-6" : "relative min-h-screen overflow-auto bg-[#08090b]"}`}
      role={embedded ? "dialog" : undefined}
      aria-modal={embedded ? true : undefined}
      aria-label={embedded ? "Connect a private node" : undefined}
      onMouseDown={(event) => { if (embedded && event.target === event.currentTarget) onClose?.(); }}
    >
      <div className={`relative grid overflow-hidden bg-[#08090b] lg:grid-cols-[0.82fr_1.18fr] ${embedded ? "my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-[1.75rem] border border-white/10 shadow-[0_30px_90px_rgba(0,0,0,.62)] sm:max-h-[calc(100dvh-3rem)]" : "mx-auto min-h-screen max-w-7xl"}`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(232,91,30,0.16),transparent_28%),radial-gradient(circle_at_82%_76%,rgba(255,255,255,0.05),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-y-0 left-[11%] w-px bg-gradient-to-b from-transparent via-orange-400/30 to-transparent" />
        {embedded ? <button type="button" onClick={onClose} className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/65 text-white/65 transition hover:bg-white/10 hover:text-white sm:right-5 sm:top-5" aria-label="Close private node connection"><X size={20} /></button> : null}
        <aside className="relative flex flex-col justify-between border-b border-white/10 px-5 py-5 sm:px-6 sm:py-7 lg:border-b-0 lg:border-r lg:px-10 lg:py-10">
          <a href="/" className="inline-flex w-fit items-center gap-2 text-xs font-black uppercase tracking-[0.26em] text-white/55 transition hover:text-white">
            <ArrowLeft size={15} /> Spilled Cinema
          </a>
          <div className="py-7 sm:py-10 lg:py-0">
            <div className="mb-5 hidden h-12 w-12 items-center justify-center rounded-full border border-orange-300/35 bg-orange-400/10 text-orange-300 sm:inline-flex">
              <LockKeyhole size={21} />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.32em] text-orange-300">Private projection room</p>
            <h1 className="mt-3 max-w-lg font-serif text-3xl leading-[0.98] tracking-[-0.045em] sm:mt-4 sm:text-6xl lg:text-7xl">
              Your server.<br /><em className="font-normal text-white/48">No address hunt.</em>
            </h1>
            <p className="mt-3 max-w-md text-xs font-medium leading-5 text-white/46 sm:mt-6 sm:text-sm sm:leading-6">
              Your short login only locates your server and viewing account. Your password or passkey is checked inside your node, and the trip stays encrypted through the gateway.
            </p>
          </div>
          <div className="hidden items-center gap-3 text-xs font-bold text-white/35 lg:flex">
            <span className={`h-2 w-2 rounded-full ${nodeOnline ? "bg-emerald-400" : "bg-white/20"}`} />
            {nodeOnline ? "Node link verified" : "Waiting for a node"}
          </div>
        </aside>

        <section className="relative flex items-center px-5 py-7 sm:px-10 sm:py-10 lg:px-16">
          <div className="w-full max-w-2xl">
            {step === "locate" ? (
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-white/35">Step 01 / Locate</p>
                <h2 className="mt-3 text-2xl font-black tracking-[-0.035em] sm:text-5xl">Connect to your node</h2>
                <p className="mt-3 text-sm leading-6 text-white/48">Enter the viewing username and network name chosen on your server PC. The long connection code still works for recovery.</p>
                <label className="mt-9 block">
                  <span className="sr-only">Private node login</span>
                  <input
                    autoFocus
                    autoComplete="off"
                    inputMode="text"
                    value={displayLocator(code)}
                    onChange={(event) => setCode(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void connect(); }}
                    placeholder="kao.home-cinema"
                    className="w-full border-b border-white/18 bg-transparent py-5 font-mono text-2xl font-bold tracking-[0.04em] text-white outline-none transition placeholder:text-white/16 focus:border-orange-300 sm:text-4xl"
                  />
                </label>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => void connect()} disabled={busy || !(normalizeNodeConnectionCode(code) || parsePrivateNodeLoginName(code))} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#f3eee5] px-7 text-sm font-black text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35">
                    {busy ? <LoaderCircle className="animate-spin" size={18} /> : <Server size={18} />} Connect securely
                  </button>
                  <button onClick={() => void findThisDevice()} disabled={finding || busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.035] px-6 text-sm font-black text-white/72 transition hover:border-white/25 hover:text-white disabled:opacity-40">
                    {finding ? <LoaderCircle className="animate-spin" size={18} /> : <LocateFixed size={18} />} Find on this device
                  </button>
                </div>
              </div>
            ) : null}

            {step === "login" ? (
              <div>
                <button onClick={() => setStep("locate")} className="mb-6 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-white/38 hover:text-white"><ArrowLeft size={14} /> Change node</button>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">Node verified · {connection.networkName ?? connection.connectionCode}</p>
                <h2 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-5xl">{loginUsername ? `Sign in as ${loginUsername}` : "Who’s watching?"}</h2>
                {!loginUsername ? <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {accounts.map((account) => (
                    <button key={account.accountId} onClick={() => chooseAccount(account.accountId)} className={`rounded-2xl border p-4 text-left transition ${accountId === account.accountId ? "border-orange-300/60 bg-orange-300/10" : "border-white/9 bg-white/[0.025] hover:border-white/20"}`}>
                      <div className="font-black">{account.displayName}</div>
                      <div className="mt-1 text-xs font-bold text-white/35">{account.profiles.length} {account.profiles.length === 1 ? "profile" : "profiles"}</div>
                    </button>
                  ))}
                </div> : null}
                {selectedAccount && selectedAccount.profiles.length > 1 ? (
                  <div className="mt-5 flex flex-wrap gap-2" aria-label="Profile">
                    {selectedAccount.profiles.map((profile) => (
                      <button key={profile.profileId} onClick={() => setProfileId(profile.profileId)} className={`rounded-full px-4 py-2 text-xs font-black ${profileId === profile.profileId ? "bg-white text-black" : "bg-white/7 text-white/55"}`}>{profile.displayName}</button>
                    ))}
                  </div>
                ) : null}
                {!selectedAccountHasPassword && !selectedAccountHasPasskey ? (
                  <div className="mt-8 rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-5 text-sm font-semibold leading-6 text-amber-50/80">
                    This viewing account has no sign-in method yet. On the server PC, open the Spilled Server tray → <strong>Open setup and settings</strong> → <strong>Accounts</strong>, then set a viewing password. Sharing can stay completely off.
                  </div>
                ) : null}
                {selectedAccountHasPassword ? (
                  <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void passwordLogin(); }} type="password" autoComplete="current-password" placeholder="Viewing password" className="min-h-12 rounded-full border border-white/12 bg-black/30 px-5 text-sm font-bold outline-none transition placeholder:text-white/25 focus:border-orange-300" />
                    <button onClick={() => void passwordLogin()} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-black text-black disabled:opacity-40">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <KeyRound size={18} />} Sign in</button>
                  </div>
                ) : null}
                {selectedAccountHasPasskey ? <button onClick={() => void passkeyLogin()} disabled={busy} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.035] text-sm font-black text-white/75 transition hover:border-white/25 hover:text-white disabled:opacity-40"><LockKeyhole size={18} /> Use a passkey instead</button> : null}
              </div>
            ) : null}

            {step === "connected" ? (
              <div className="rounded-[2rem] border border-emerald-300/20 bg-emerald-300/[0.055] p-7 sm:p-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-300 text-black"><Check size={27} strokeWidth={3} /></div>
                <p className="mt-7 text-xs font-black uppercase tracking-[0.28em] text-emerald-200">Connection ready</p>
                <h2 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-5xl">Welcome, {connection.profileName ?? connection.accountName ?? "home"}.</h2>
                <p className="mt-4 max-w-lg text-sm leading-6 text-white/50">This browser now knows your node by identity, not by a tunnel address. You can change profiles or disconnect in Settings.</p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  {embedded ? <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-black text-black">Back to Home</button> : <a href="/" className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-black text-black">Enter the library</a>}
                  {connection.connectionCode ? <a href={`/node/admin?code=${encodeURIComponent(connection.connectionCode)}`} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/12 bg-white/[.045] px-7 text-sm font-black text-white/75">Manage server</a> : null}
                  <button type="button" onClick={handleLogout} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-red-300/20 bg-red-300/[.055] px-7 text-sm font-black text-red-100/80 transition hover:border-red-300/35 hover:bg-red-300/10 hover:text-red-50"><LogOut size={17} /> Log out</button>
                </div>
              </div>
            ) : null}

            {message ? (
              <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200/15 bg-amber-200/[0.055] px-4 py-3 text-sm font-semibold leading-5 text-amber-50/75">
                <WifiOff className="mt-0.5 shrink-0" size={17} /> {message}
              </div>
            ) : null}
            <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-white/27"><span>Setting up a brand-new server? <a href="/node/setup" className="text-white/55 underline decoration-white/20 underline-offset-4 hover:text-white">Open local setup</a>.</span><a href="/private-node-guide" className="inline-flex items-center gap-1.5 text-white/55 underline decoration-white/20 underline-offset-4 hover:text-white"><BookOpen size={13} /> Private setup guide</a></p>
          </div>
        </section>
      </div>
    </main>
  );
}
