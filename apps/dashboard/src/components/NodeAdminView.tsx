import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Database, Film, LockKeyhole, Plus, RefreshCw, ServerCog, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import {
  clearAdminNodeConnection,
  createAdminWatcher,
  fetchAdminNodeStatus,
  loginAdminNodePassword,
  readAdminNodeConnection,
  saveAdminNodeCapabilities,
  writeAdminNodeConnection,
  type PrivateNodeAccount,
} from "../lib/private-node-client";

function formatBytes(value: number) {
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${Math.round(value / (1024 * 1024 * 1024))} GB`;
}

function cleanId(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || fallback;
}

export function NodeAdminView() {
  const queryNode = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("node")?.replace(/\/+$/, "") ?? "";
  }, []);
  const [connection, setConnection] = useState(() => {
    const saved = readAdminNodeConnection();
    // A link to another node must never receive the saved node's bearer token.
    return queryNode && queryNode !== saved.nodeUrl ? { nodeUrl: queryNode, token: null, adminId: null, adminName: null } : saved;
  });
  const [adminId, setAdminId] = useState(connection.adminId ?? "admin");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchAdminNodeStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({
    fetch: true,
    search: true,
    import: true,
    stream: true,
    download: true,
    spillshare: false,
    relay: false,
  });
  const [watcherName, setWatcherName] = useState("");
  const [watcherPassword, setWatcherPassword] = useState("");
  const [profiles, setProfiles] = useState("");
  const [quotaGb, setQuotaGb] = useState(200);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function refresh(nextConnection = connection) {
    if (!nextConnection.nodeUrl || !nextConnection.token) return;
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await fetchAdminNodeStatus(nextConnection.nodeUrl, nextConnection.token);
      setStatus(nextStatus);
      const nodeCapabilities = nextStatus.status.node?.capabilities;
      if (nodeCapabilities) {
        setCapabilities({
          fetch: nodeCapabilities.fetch?.visibility === "public",
          search: nextStatus.status.capabilities?.providerSearch !== false,
          import: nextStatus.status.capabilities?.providerImport !== false,
          stream: nodeCapabilities.stream?.visibility === "public",
          download: nodeCapabilities.download?.visibility === "public",
          spillshare: nodeCapabilities.spillshare?.visibility === "public",
          relay: nodeCapabilities.relay?.visibility === "public",
        });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load admin status.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function login() {
    const nodeUrl = connection.nodeUrl.trim().replace(/\/+$/, "");
    if (!nodeUrl || !adminId.trim() || !password) {
      setMessage("Enter the server address, admin username, and password.");
      passwordRef.current?.focus();
      return;
    }
    try {
      const parsed = new URL(nodeUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setMessage("Enter a valid HTTP or HTTPS server address.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await loginAdminNodePassword({ nodeUrl, adminId: adminId.trim(), password });
      const next = writeAdminNodeConnection({
        nodeUrl,
        token: result.token,
        adminId: result.admin.adminId,
        adminName: result.admin.displayName,
      });
      setConnection(next);
      setPassword("");
      await refresh(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid username or password.");
    } finally {
      setBusy(false);
    }
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) void login();
  }

  async function saveCapabilities() {
    if (!connection.nodeUrl || !connection.token) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveAdminNodeCapabilities(connection.nodeUrl, connection.token, capabilities);
      await refresh();
      setMessage("Server capabilities saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save capabilities.");
    } finally {
      setBusy(false);
    }
  }

  async function addWatcher() {
    if (!connection.nodeUrl || !connection.token || !watcherName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await createAdminWatcher({
        nodeUrl: connection.nodeUrl,
        token: connection.token,
        watcherId: cleanId(`watcher_${watcherName}`, "watcher"),
        displayName: watcherName,
        password: watcherPassword || undefined,
        quotaBytes: Math.max(1, Math.round(quotaGb)) * 1024 * 1024 * 1024,
        profiles: profiles.split(",").filter(Boolean).map((name, index) => ({
          profileId: cleanId(`prof_${name}`, `prof_${index + 1}`),
          displayName: name.trim(),
          avatar: "default",
        })),
      });
      setWatcherName("");
      setWatcherPassword("");
      setProfiles("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create watcher.");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    const next = clearAdminNodeConnection();
    setConnection(next);
    setStatus(null);
  }

  const signedIn = Boolean(connection.token);

  return (
    <div className="min-h-[100dvh] bg-[#090a0e] px-[max(1rem,env(safe-area-inset-left))] py-[max(1.25rem,env(safe-area-inset-top))] text-white sm:px-8 sm:py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.32em] text-orange-300">Node admin</span>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Server management</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-white/55">Admin accounts manage capabilities and watchers. Watcher accounts own profiles, libraries, and downloads.</p>
          </div>
          {signedIn ? <button onClick={disconnect} className="rounded-full bg-white/10 px-4 py-2 text-sm font-black">Disconnect</button> : null}
        </header>

        {message ? <div className="rounded-xl border border-red-300/20 bg-red-400/8 px-4 py-3 text-sm font-semibold text-red-100" role="alert" aria-live="assertive">{message}</div> : null}

        {!signedIn ? (
          <main className="grid min-h-[min(68dvh,44rem)] overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#13151a] shadow-[0_28px_90px_rgba(0,0,0,.42)] lg:grid-cols-[0.9fr_1.1fr]">
            <aside className="relative hidden overflow-hidden border-r border-white/[0.07] bg-[#0e1014] p-10 lg:flex lg:flex-col lg:justify-between">
              <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />
              <div className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-200/15 bg-orange-300/10 text-orange-200"><Film size={22} /></div>
                <p className="mt-8 max-w-sm text-3xl font-black leading-tight tracking-[-0.035em]">Your server.<br />Your library.<br />Your rules.</p>
              </div>
              <div className="relative space-y-3 text-sm text-white/48">
                <p className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-300" /> Credentials go directly to your node.</p>
                <p>Spilled does not change the authentication or session policy configured during setup.</p>
              </div>
            </aside>

            <section className="flex items-center p-5 sm:p-9 lg:p-12" aria-labelledby="admin-login-title">
              <form className="mx-auto w-full max-w-md" onSubmit={handleLoginSubmit} noValidate>
                <a href="/" className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-xs font-bold text-white/45 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><ArrowLeft size={15} /> Back to Spilled</a>
                <div className="mb-7 flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/7 text-orange-200"><LockKeyhole size={20} /></div>
                  <div>
                    <h2 id="admin-login-title" className="text-2xl font-black tracking-[-0.03em] sm:text-3xl">Sign in to your node</h2>
                    <p className="mt-1.5 text-sm leading-6 text-white/48">Use the management account created during private-server setup.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block" htmlFor="node-url">
                    <span className="mb-1.5 block text-xs font-bold text-white/62">Server address</span>
                    <input id="node-url" name="nodeUrl" value={connection.nodeUrl} onChange={(event) => setConnection((current) => ({ ...current, nodeUrl: event.target.value }))} type="url" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} required placeholder="https://your-node.example" className="min-h-13 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base font-semibold text-white outline-none transition placeholder:text-white/24 focus:border-orange-200/55 focus:ring-4 focus:ring-orange-200/8" />
                  </label>
                  <label className="block" htmlFor="admin-id">
                    <span className="mb-1.5 block text-xs font-bold text-white/62">Admin username</span>
                    <input id="admin-id" name="username" value={adminId} onChange={(event) => setAdminId(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="admin" className="min-h-13 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base font-semibold text-white outline-none transition placeholder:text-white/24 focus:border-orange-200/55 focus:ring-4 focus:ring-orange-200/8" />
                  </label>
                  <label className="block" htmlFor="admin-password">
                    <span className="mb-1.5 block text-xs font-bold text-white/62">Password</span>
                    <input ref={passwordRef} id="admin-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required placeholder="Your admin password" className="min-h-13 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base font-semibold text-white outline-none transition placeholder:text-white/24 focus:border-orange-200/55 focus:ring-4 focus:ring-orange-200/8" />
                  </label>
                </div>

                <button type="submit" disabled={busy} className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-black transition hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-200/30 disabled:cursor-wait disabled:opacity-55">
                  {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                  {busy ? "Signing in…" : "Sign in securely"}
                </button>
                <p className="mt-4 text-center text-xs leading-5 text-white/32">The node controls password verification, rate limits, and session lifetime.</p>
              </form>
            </section>
          </main>
        ) : (
          <div className="grid gap-5">
            <section className="grid gap-4 rounded-xl border border-white/10 bg-[#15161b] p-5 md:grid-cols-4">
              <div className="md:col-span-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ServerCog className="text-orange-300" />
                  <h2 className="text-xl font-black">Overview</h2>
                </div>
                <button onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-black"><RefreshCw size={16} />Refresh</button>
              </div>
              <Metric label="Mode" value={status?.status.node?.mode ?? "Loading"} />
              <Metric label="Watchers" value={String(status?.watchers.length ?? 0)} />
              <Metric label="Storage" value={status ? formatBytes(status.storage.usedBytes) : "Loading"} />
              <Metric label="Sessions" value={String(status?.sessions.length ?? 0)} />
            </section>

            <section className="rounded-xl border border-white/10 bg-[#15161b] p-5">
              <div className="mb-4 flex items-center gap-3">
                <SlidersHorizontal className="text-orange-300" />
                <h2 className="text-xl font-black">Public capabilities</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(capabilities).map(([key, checked]) => (
                  <label key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold capitalize">
                    {key}
                    <input type="checkbox" checked={checked} onChange={(event) => setCapabilities((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-orange-500" />
                  </label>
                ))}
              </div>
              <button onClick={() => void saveCapabilities()} disabled={busy} className="mt-4 rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-60">Save server capabilities</button>
            </section>

            <section className="rounded-xl border border-white/10 bg-[#15161b] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Users className="text-orange-300" />
                <h2 className="text-xl font-black">Watcher accounts</h2>
              </div>
              <div className="grid gap-3">
                {(status?.watchers ?? []).map((watcher: PrivateNodeAccount) => (
                  <div key={watcher.accountId} className="rounded-lg border border-white/10 bg-black/25 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-black">{watcher.displayName}</h3>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/35">{watcher.watcherId ?? watcher.accountId} · {formatBytes(watcher.quotaBytes)}</p>
                      </div>
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">{watcher.profiles.length} profiles</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 md:grid-cols-5">
                <input value={watcherName} onChange={(event) => setWatcherName(event.target.value)} placeholder="Watcher name" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                <input value={watcherPassword} onChange={(event) => setWatcherPassword(event.target.value)} type="password" placeholder="Password optional" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                <input value={profiles} onChange={(event) => setProfiles(event.target.value)} placeholder="Profiles" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                <input value={quotaGb} onChange={(event) => setQuotaGb(Number(event.target.value))} type="number" min={1} className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                <button onClick={() => void addWatcher()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-60"><Plus size={16} />Add</button>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-[#15161b] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Database className="text-orange-300" />
                <h2 className="text-xl font-black">Storage and recovery</h2>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Metric label="Root" value={status?.storage.root ?? "Not configured"} />
                <Metric label="Downloads" value={String(status?.storage.downloadsCount ?? 0)} />
                <Metric label="Recovery" value="Terminal only" />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/35">{label}</div>
      <div className="mt-2 break-words text-lg font-black text-white">{value}</div>
    </div>
  );
}
