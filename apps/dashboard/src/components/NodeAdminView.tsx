import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Copy, Database, LockKeyhole, Plus, RefreshCw, ServerCog, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import {
  clearAdminNodeConnection,
  createAdminWatcher,
  createAdminWatcherViaGateway,
  fetchAdminNodeStatus,
  fetchAdminNodeStatusViaGateway,
  loginAdminNodePassword,
  loginAdminViaGateway,
  readAdminNodeConnection,
  readPrivateNodeConnection,
  saveAdminNodeCapabilities,
  saveAdminNodeCapabilitiesViaGateway,
  writeAdminNodeConnection,
  type PrivateNodeAccount,
} from "../lib/private-node-client";
import { normalizeNodeConnectionCode } from "../../../../packages/node-protocol/src";

function displayCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 16);
  return compact.match(/.{1,4}/g)?.join("-") ?? compact;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${Math.round(value / (1024 * 1024 * 1024))} GB`;
}

function cleanId(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || fallback;
}

type AdminTab = "overview" | "people" | "privacy" | "storage";

export function NodeAdminView() {
  const queryNode = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("node")?.replace(/\/+$/, "") ?? "";
  }, []);
  const queryCode = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("code") ?? "";
  }, []);
  const [connection, setConnection] = useState(() => {
    const saved = readAdminNodeConnection();
    const viewer = readPrivateNodeConnection();
    if (queryCode) return { ...saved, nodeUrl: "", connectionCode: normalizeNodeConnectionCode(queryCode) ?? queryCode };
    if (queryNode) return { ...saved, nodeUrl: queryNode, connectionCode: null };
    if (saved.connectionCode) return saved;
    return { ...saved, nodeId: viewer.nodeId, connectionCode: viewer.connectionCode };
  });
  const [adminId, setAdminId] = useState(connection.adminId ?? "owner");
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
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [copied, setCopied] = useState(false);

  async function refresh(nextConnection = connection) {
    if (!(nextConnection.connectionCode || nextConnection.nodeUrl) || !nextConnection.token) return;
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = nextConnection.connectionCode
        ? await fetchAdminNodeStatusViaGateway(nextConnection)
        : await fetchAdminNodeStatus(nextConnection.nodeUrl, nextConnection.token);
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
    if (!(connection.connectionCode || connection.nodeUrl) || !adminId || !password) {
      setMessage("Enter the node connection code, admin username, and password.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const gatewayResult = connection.connectionCode
        ? await loginAdminViaGateway({ connection, adminId, password })
        : null;
      const result = gatewayResult ?? await loginAdminNodePassword({ nodeUrl: connection.nodeUrl, adminId, password });
      const next = writeAdminNodeConnection({
        nodeUrl: connection.nodeUrl,
        nodeId: gatewayResult?.nodeId ?? connection.nodeId,
        connectionCode: gatewayResult?.connectionCode ?? connection.connectionCode,
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

  async function saveCapabilities() {
    if (!(connection.connectionCode || connection.nodeUrl) || !connection.token) return;
    setBusy(true);
    setMessage(null);
    try {
      if (connection.connectionCode) await saveAdminNodeCapabilitiesViaGateway(connection, capabilities);
      else await saveAdminNodeCapabilities(connection.nodeUrl, connection.token, capabilities);
      await refresh();
      setMessage("Server capabilities saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save capabilities.");
    } finally {
      setBusy(false);
    }
  }

  async function addWatcher() {
    if (!(connection.connectionCode || connection.nodeUrl) || !connection.token || !watcherName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const watcherInput = {
        watcherId: cleanId(`watcher_${watcherName}`, "watcher"),
        displayName: watcherName,
        password: watcherPassword || undefined,
        quotaBytes: Math.max(1, Math.round(quotaGb)) * 1024 * 1024 * 1024,
        profiles: profiles.split(",").filter(Boolean).map((name, index) => ({
          profileId: cleanId(`prof_${name}`, `prof_${index + 1}`),
          displayName: name.trim(),
          avatar: "default",
        })),
      };
      if (connection.connectionCode) await createAdminWatcherViaGateway(connection, watcherInput);
      else await createAdminWatcher({ nodeUrl: connection.nodeUrl, token: connection.token, ...watcherInput });
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

  async function copyConnectionCode() {
    if (!connection.connectionCode) return;
    await navigator.clipboard.writeText(displayCode(connection.connectionCode));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const signedIn = Boolean(connection.token);

  return (
    <div className="min-h-screen bg-[#0b0c10] px-5 py-8 text-white sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.32em] text-orange-300">Node admin</span>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Server management</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-white/55">Find your node with the same connection code, then securely manage capabilities, watchers, profiles, and storage from this app.</p>
          </div>
          {signedIn ? <button onClick={disconnect} className="rounded-full bg-white/10 px-4 py-2 text-sm font-black">Disconnect</button> : null}
        </header>

        {message ? <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/75">{message}</div> : null}

        {!signedIn ? (
          <section className="rounded-xl border border-white/10 bg-[#15161b] p-5">
            <div className="mb-5 flex items-center gap-3">
              <LockKeyhole className="text-orange-300" />
              <div>
                <h2 className="text-xl font-black">Admin login</h2>
                <p className="text-sm font-medium text-white/55">Use the management account created during setup.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto]">
              <input value={displayCode(connection.connectionCode ?? "")} onChange={(event) => setConnection((current) => ({ ...current, nodeUrl: "", nodeId: null, connectionCode: displayCode(event.target.value) }))} placeholder="7A3F-19C2-88B4-D0E1" aria-label="Private node connection code" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 font-mono text-sm font-bold uppercase tracking-[.08em] outline-none focus:border-orange-300" />
              <input value={adminId} onChange={(event) => setAdminId(event.target.value)} placeholder="admin" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <button onClick={() => void login()} disabled={busy} className="rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-60">Sign in</button>
            </div>
            <p className="mt-3 text-xs font-semibold text-white/32">No IP address or server URL needed. The code locates the node; your admin password authorizes every change on the node itself.</p>
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="self-start rounded-3xl border border-white/10 bg-[#15161b] p-4 lg:sticky lg:top-6">
              <div className="rounded-2xl border border-orange-300/25 bg-orange-300/[0.06] p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-200/65">Permanent code</div>
                <div className="mt-2 break-all font-mono text-lg font-black tracking-[0.09em] text-orange-200">{displayCode(connection.connectionCode ?? "") || "Local connection"}</div>
                {connection.connectionCode ? <button onClick={() => void copyConnectionCode()} className="mt-3 inline-flex items-center gap-2 text-xs font-black text-white/70 hover:text-white"><Copy size={14} />{copied ? "Copied" : "Copy code"}</button> : null}
              </div>
              <nav className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-1" aria-label="Server settings">
                <AdminTabButton active={activeTab === "overview"} icon={<Activity size={17} />} label="Overview" onClick={() => setActiveTab("overview")} />
                <AdminTabButton active={activeTab === "people"} icon={<Users size={17} />} label="People" onClick={() => setActiveTab("people")} />
                <AdminTabButton active={activeTab === "privacy"} icon={<ShieldCheck size={17} />} label="Privacy" onClick={() => setActiveTab("privacy")} />
                <AdminTabButton active={activeTab === "storage"} icon={<Database size={17} />} label="Storage" onClick={() => setActiveTab("storage")} />
              </nav>
            </aside>

            <main className="min-w-0">
              {activeTab === "overview" ? (
                <section className="rounded-3xl border border-white/10 bg-[#15161b] p-5 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3"><ServerCog className="text-orange-300" /><div><h2 className="text-2xl font-black">Server overview</h2><p className="text-sm font-medium text-white/45">Live health and activity for this private node.</p></div></div>
                    <button onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-black"><RefreshCw className={busy ? "animate-spin" : ""} size={16} />Refresh</button>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Mode" value={status?.status.node?.mode ?? "Loading"} />
                    <Metric label="People" value={String(status?.watchers.length ?? 0)} />
                    <Metric label="Used storage" value={status ? formatBytes(status.storage.usedBytes) : "Loading"} />
                    <Metric label="Active sessions" value={String(status?.sessions.length ?? 0)} />
                  </div>
                  <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm font-semibold text-emerald-100"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-300" />Connected securely through the managed gateway. No public server URL is required.</div>
                </section>
              ) : null}

              {activeTab === "people" ? (
                <section className="rounded-3xl border border-white/10 bg-[#15161b] p-5 sm:p-7">
                  <div className="mb-5 flex items-center gap-3"><Users className="text-orange-300" /><div><h2 className="text-2xl font-black">People & profiles</h2><p className="text-sm font-medium text-white/45">Create private accounts and control each person’s storage allowance.</p></div></div>
                  <div className="grid gap-3">
                    {(status?.watchers ?? []).map((watcher: PrivateNodeAccount) => (
                      <div key={watcher.accountId} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black">{watcher.displayName}</h3><p className="text-xs font-bold uppercase tracking-[0.18em] text-white/35">{watcher.watcherId ?? watcher.accountId} · {formatBytes(watcher.quotaBytes)}</p></div><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">{watcher.profiles.length} profiles</span></div>
                      </div>
                    ))}
                    {!status?.watchers.length ? <p className="rounded-2xl border border-dashed border-white/15 p-5 text-sm font-semibold text-white/40">No watcher accounts yet.</p> : null}
                  </div>
                  <div className="mt-6 border-t border-white/10 pt-6"><h3 className="font-black">Add a person</h3><p className="mt-1 text-xs font-semibold text-white/35">Separate profile names with commas.</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <input value={watcherName} onChange={(event) => setWatcherName(event.target.value)} placeholder="Name" className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                      <input value={watcherPassword} onChange={(event) => setWatcherPassword(event.target.value)} type="password" placeholder="Password (optional)" className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                      <input value={profiles} onChange={(event) => setProfiles(event.target.value)} placeholder="Profiles" className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                      <label className="grid gap-1 text-[10px] font-black uppercase tracking-[.16em] text-white/35">Quota (GB)<input aria-label="Storage quota in GB" value={quotaGb} onChange={(event) => setQuotaGb(Number(event.target.value))} type="number" min={1} className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-orange-300" /></label>
                      <button onClick={() => void addWatcher()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-60"><Plus size={16} />Add person</button>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeTab === "privacy" ? (
                <section className="rounded-3xl border border-white/10 bg-[#15161b] p-5 sm:p-7">
                  <div className="mb-5 flex items-center gap-3"><SlidersHorizontal className="text-orange-300" /><div><h2 className="text-2xl font-black">Privacy & contribution</h2><p className="text-sm font-medium text-white/45">Choose exactly what this PC may contribute outside your private library.</p></div></div>
                  <div className="mb-5 rounded-2xl border border-orange-300/20 bg-orange-300/[0.05] p-4 text-sm font-semibold text-orange-100/80">Everything stays private unless you enable a capability here. Changes are stored on the node and require your admin session.</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(capabilities).map(([key, checked]) => <label key={key} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm font-bold capitalize"><span>{key}</span><input type="checkbox" checked={checked} onChange={(event) => setCapabilities((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-orange-500" /></label>)}
                  </div>
                  <button onClick={() => void saveCapabilities()} disabled={busy} className="mt-5 rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-60">Save privacy settings</button>
                </section>
              ) : null}

              {activeTab === "storage" ? (
                <section className="rounded-3xl border border-white/10 bg-[#15161b] p-5 sm:p-7">
                  <div className="mb-5 flex items-center gap-3"><Database className="text-orange-300" /><div><h2 className="text-2xl font-black">Storage & recovery</h2><p className="text-sm font-medium text-white/45">See where your library lives and check local recovery options.</p></div></div>
                  <div className="grid gap-3 md:grid-cols-3"><Metric label="Library root" value={status?.storage.root ?? "Not configured"} /><Metric label="Downloads" value={String(status?.storage.downloadsCount ?? 0)} /><Metric label="Used space" value={status ? formatBytes(status.storage.usedBytes) : "Loading"} /></div>
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4"><h3 className="font-black">Recovery</h3><p className="mt-1 text-sm font-medium leading-6 text-white/45">Identity and settings remain in Windows app data during reinstall. Advanced recovery stays local to the server terminal.</p></div>
                </section>
              ) : null}
            </main>
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

function AdminTabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-black transition ${active ? "bg-orange-500 text-black" : "text-white/55 hover:bg-white/[0.06] hover:text-white"}`}>
      {icon}<span>{label}</span>
    </button>
  );
}
