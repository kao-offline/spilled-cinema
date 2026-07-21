import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Radar, Server } from "lucide-react";
import {
  completePrivateNodeSetup,
  fetchPrivateNodeSetupStatus,
  fetchPrivateNodeStatus,
  findPrivateNodeCandidates,
  writeAdminNodeConnection,
  writePrivateNodeConnection,
} from "../lib/private-node-client";

type Step = "find" | "verify" | "admin" | "server" | "watchers" | "done";

function cleanId(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || fallback;
}

export function NodeSetupView() {
  const queryNode = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("node")?.replace(/\/+$/, "") ?? "";
  }, []);
  const [step, setStep] = useState<Step>("find");
  const [nodeUrl, setNodeUrl] = useState(queryNode);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [nodeName, setNodeName] = useState("Home Server");
  const [adminId, setAdminId] = useState("admin");
  const [adminName, setAdminName] = useState("Admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminConfirm, setAdminConfirm] = useState("");
  const [publicCapabilities, setPublicCapabilities] = useState({
    fetch: true,
    search: true,
    import: true,
    stream: true,
    download: true,
    spillshare: false,
    relay: false,
  });
  const [watcherName, setWatcherName] = useState("Owner");
  const [watcherPassword, setWatcherPassword] = useState("");
  const [profileNames, setProfileNames] = useState("Owner");
  const [quotaGb, setQuotaGb] = useState(500);

  useEffect(() => {
    if (!queryNode) return;
    void verifyNode(queryNode);
  }, [queryNode]);

  async function verifyNode(url = nodeUrl) {
    const clean = url.trim().replace(/\/+$/, "");
    if (!clean) {
      setMessage("Start the server, then find it or paste the URL printed in the terminal.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await fetchPrivateNodeStatus(clean);
      await fetchPrivateNodeSetupStatus(clean);
      setNodeUrl(clean);
      setStep("verify");
      writePrivateNodeConnection({ nodeUrl: clean, token: null, accountId: null, accountName: null, profileId: null, profileName: null });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach this node.");
    } finally {
      setBusy(false);
    }
  }

  async function findNode() {
    setBusy(true);
    setMessage(null);
    try {
      const candidates = await findPrivateNodeCandidates(queryNode ? [queryNode] : []);
      const candidate = candidates.find((entry) => entry.status.auth?.setupRequired) ?? candidates[0];
      if (!candidate) {
        setMessage("No setup-ready server found. Run npm run start:server and try again.");
        return;
      }
      await verifyNode(candidate.nodeUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not find a server.");
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    if (adminPassword.length < 10) {
      setMessage("Admin password must be at least 10 characters.");
      setStep("admin");
      return;
    }
    if (adminPassword !== adminConfirm) {
      setMessage("Admin passwords do not match.");
      setStep("admin");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const watcherId = cleanId(`watcher_${watcherName}`, "watcher_owner");
      const profiles = profileNames.split(",").map((name, index) => ({
        profileId: cleanId(`prof_${name}`, `prof_${index + 1}`),
        displayName: name.trim() || `Profile ${index + 1}`,
        avatar: "default",
      }));
      const result = await completePrivateNodeSetup({
        nodeUrl,
        setupCode,
        nodeName,
        admin: {
          adminId: cleanId(adminId, "admin"),
          displayName: adminName.trim() || "Admin",
          password: adminPassword,
        },
        publicCapabilities,
        initialWatchers: [{
          watcherId,
          displayName: watcherName.trim() || "Owner",
          password: watcherPassword || undefined,
          quotaBytes: Math.max(1, Math.round(quotaGb)) * 1024 * 1024 * 1024,
          profiles,
        }],
      });
      writeAdminNodeConnection({
        nodeUrl,
        token: null,
        adminId: result.admin?.adminId ?? cleanId(adminId, "admin"),
        adminName: result.admin?.displayName ?? adminName,
      });
      setStep("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  const steps: Array<{ id: Step; label: string }> = [
    { id: "find", label: "Find" },
    { id: "verify", label: "Verify" },
    { id: "admin", label: "Admin" },
    { id: "server", label: "Server" },
    { id: "watchers", label: "Watchers" },
    { id: "done", label: "Done" },
  ];
  const stepIndex = steps.findIndex((entry) => entry.id === step);

  return (
    <div className="min-h-screen bg-[#0b0c10] px-5 py-8 text-white sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-6">
          <span className="text-xs font-bold uppercase tracking-[0.32em] text-orange-300">Private node setup</span>
          <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Bind this server to Spilled</h1>
          <p className="max-w-2xl text-sm font-medium leading-6 text-white/55">
            Run <span className="font-mono text-white">npm run start:server</span>, enter the terminal code, then create the local admin account that manages this node.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-6">
          {steps.map((entry, index) => (
            <div key={entry.id} className={`rounded-lg border px-3 py-2 text-xs font-black uppercase tracking-[0.2em] ${index <= stepIndex ? "border-orange-400/60 bg-orange-400 text-black" : "border-white/10 bg-white/[0.03] text-white/35"}`}>
              {entry.label}
            </div>
          ))}
        </div>

        {message ? <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100">{message}</div> : null}

        <section className="rounded-xl border border-white/10 bg-[#15161b] p-5 shadow-2xl shadow-black/30">
          {step === "find" ? (
            <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <h2 className="text-xl font-black">Find your running server</h2>
                <p className="mt-2 text-sm font-medium text-white/55">The setup URL from the terminal is fastest. Find server also checks saved and registered nodes.</p>
              </div>
              <button onClick={() => void findNode()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-60">
                <Radar size={18} /> {busy ? "Finding" : "Find server"}
              </button>
              <button onClick={() => setManualOpen((value) => !value)} className="text-left text-xs font-bold uppercase tracking-[0.24em] text-white/45">Use URL manually</button>
              {manualOpen ? (
                <div className="flex gap-2 md:col-span-2">
                  <input value={nodeUrl} onChange={(event) => setNodeUrl(event.target.value)} placeholder="https://node-url.loca.lt" className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
                  <button onClick={() => void verifyNode()} disabled={busy} className="rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">Connect</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "verify" ? (
            <div className="grid gap-5">
              <div className="flex items-start gap-3">
                <Server className="mt-1 text-orange-300" size={22} />
                <div>
                  <h2 className="text-xl font-black">Verify this node</h2>
                  <p className="mt-1 break-all text-sm font-medium text-white/55">{nodeUrl}</p>
                </div>
              </div>
              <input value={setupCode} onChange={(event) => setSetupCode(event.target.value.toUpperCase())} placeholder="A1B2C3" className="max-w-xs rounded-full border border-white/10 bg-black/40 px-5 py-3 text-center font-mono text-lg font-black uppercase tracking-[0.24em] outline-none focus:border-orange-300" />
              <button onClick={() => setStep("admin")} disabled={setupCode.trim().length < 6} className="w-fit rounded-full bg-white px-5 py-3 text-sm font-black text-black disabled:opacity-40">Continue</button>
            </div>
          ) : null}

          {step === "admin" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <h2 className="text-xl font-black">Create management admin</h2>
                <p className="mt-1 text-sm font-medium text-white/55">This is only for server settings. Watcher accounts are created separately.</p>
              </div>
              <input value={adminId} onChange={(event) => setAdminId(event.target.value)} placeholder="admin" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={adminName} onChange={(event) => setAdminName(event.target.value)} placeholder="Display name" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} type="password" placeholder="Password, minimum 10 characters" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={adminConfirm} onChange={(event) => setAdminConfirm(event.target.value)} type="password" placeholder="Confirm password" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <button onClick={() => setStep("server")} className="w-fit rounded-full bg-white px-5 py-3 text-sm font-black text-black">Continue</button>
            </div>
          ) : null}

          {step === "server" ? (
            <div className="grid gap-4">
              <h2 className="text-xl font-black">Choose public capabilities</h2>
              <input value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="Node name" className="max-w-md rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(publicCapabilities).map(([key, checked]) => (
                  <label key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold capitalize">
                    {key}
                    <input type="checkbox" checked={checked} onChange={(event) => setPublicCapabilities((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-orange-500" />
                  </label>
                ))}
              </div>
              <button onClick={() => setStep("watchers")} className="w-fit rounded-full bg-white px-5 py-3 text-sm font-black text-black">Continue</button>
            </div>
          ) : null}

          {step === "watchers" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <h2 className="text-xl font-black">Create first watcher</h2>
                <p className="mt-1 text-sm font-medium text-white/55">This account owns profiles, library state, downloads, and quota usage.</p>
              </div>
              <input value={watcherName} onChange={(event) => setWatcherName(event.target.value)} placeholder="Watcher name" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={watcherPassword} onChange={(event) => setWatcherPassword(event.target.value)} type="password" placeholder="Watcher password, optional" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={profileNames} onChange={(event) => setProfileNames(event.target.value)} placeholder="Profiles, comma separated" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <input value={quotaGb} onChange={(event) => setQuotaGb(Number(event.target.value))} type="number" min={1} className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <button onClick={() => void finishSetup()} disabled={busy} className="w-fit rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">Finish setup</button>
            </div>
          ) : null}

          {step === "done" ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-400 p-2 text-black"><Check size={22} /></div>
                <div>
                  <h2 className="text-xl font-black">Server ready</h2>
                  <p className="mt-1 text-sm font-medium text-white/55">Now sign into the admin page to manage this node.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={`/node/admin?node=${encodeURIComponent(nodeUrl)}`} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black">Open Admin <ChevronRight size={16} /></a>
                <a href="/" className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-black text-white">Open App</a>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
