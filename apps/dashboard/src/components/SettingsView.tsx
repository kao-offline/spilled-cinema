import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  Image as ImageIcon, Key,
  LockKeyhole,
  Package,
  PlugZap,
  Plus,
  RefreshCw,
  Rss,
  SlidersHorizontal,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { DownloadEngine, IntegrationManifestV2, LibrarySettings, ProviderFeedCatalogEntry } from "../lib/types";
import { INTEGRATIONS, type IntegrationId } from "../lib/integrations";
import { DEFAULT_PROVIDER_REPOSITORY_URL } from "../lib/provider-feed-storage";
import type { LocalRuntimeStatus } from "../lib/runtime-bridge";
import { getConnectionModeLabel } from "../lib/runtime-bridge";
import {
  readIntegrationUserCredentials,
  readIntegrationUserKeys,
  writeIntegrationUserCredentials,
  writeIntegrationUserKeys,
} from "../lib/integration-user-config";
import type { VaultDiagnostics, VaultStatus } from "../lib/library-folder";
import { isFolderConnectionSupported } from "../lib/library-folder";
import {
  clearPrivateNodeConnection,
  completePrivateNodeSetup,
  enrollPrivateNodePasskey,
  fetchPrivateNodeAccounts,
  findPrivateNodeCandidates,
  fetchPrivateNodeSetupStatus,
  fetchPrivateNodeStatus,
  fetchPrivateNodeStorage,
  loginWatcherNodePassword,
  loginPrivateNodePasskey,
  logoutPrivateNode,
  readPrivateNodeConnection,
  selectPrivateNodeProfile,
  writePrivateNodeConnection,
  type PrivateNodeAccount,
  type PrivateNodeConnection,
  type PrivateNodeStorageSummary,
} from "../lib/private-node-client";
import { verifySvetSerialuLogin } from "../lib/svetserialu-auth-client";

type SettingsViewProps = {
  settings: LibrarySettings;
  onSettingsChange: (s: Partial<LibrarySettings>) => void;
  offlineUsageBytes: number;
  offlineEpisodeCount: number;
  onClearOffline: () => void;
  onRefreshArtwork: () => void | Promise<void>;
  artworkRefreshBusy: boolean;
  artworkRefreshSummary: string | null;
  onExportLibrary: () => void;
  onImportLibrary: (file: File) => void | Promise<void>;
  localRuntimeStatus: LocalRuntimeStatus;
  onRefreshLocalRuntime: () => void;
  vaultStatus: VaultStatus;
  vaultDiagnostics: VaultDiagnostics;
  onConnectVault: () => Promise<void>;
  onReconnectVaultAccess: () => Promise<void>;
  onDisconnectVault: () => Promise<void>;
  onResetVaultLink: () => Promise<void>;
  onRefreshVaultStatus: () => void | Promise<void>;
  providerFeeds: ProviderFeedCatalogEntry[];
  integrationCatalog: IntegrationManifestV2[];
  providerRepositoryUrls: string[];
  onToggleProviderFeed: (moduleId: string, feedId: string) => void;
  onProviderRepositoriesChange: (urls: string[]) => void;
};

type SettingsTab = "general" | "storage" | "sources" | "private" | "advanced";

function Panel({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-[1.4rem] border border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.16)] sm:p-6", className)}>
      <div className="mb-5 flex flex-col gap-1">
        <h3 className="text-base font-bold tracking-tight text-white">{title}</h3>
        {hint ? <p className="max-w-2xl text-sm leading-6 text-white/48">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PreferenceRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-white/[0.07] py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        {hint ? <div className="mt-1 max-w-xl text-sm leading-6 text-white/45">{hint}</div> : null}
      </div>
      <div className="min-w-0 max-w-full shrink-0">{children}</div>
    </div>
  );
}

function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "good" | "warn" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]",
        tone === "good" && "bg-emerald-500/14 text-emerald-200",
        tone === "warn" && "bg-amber-500/14 text-amber-200",
        tone === "neutral" && "bg-white/8 text-white/58",
      )}
    >
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        "relative inline-flex h-7 w-12 items-center rounded-full border transition",
        checked ? "border-white bg-white" : "border-white/10 bg-white/[0.08]",
      )}
      aria-label={label}
      aria-pressed={checked}
    >
      <span
        className={clsx(
          "inline-block h-5 w-5 rounded-full shadow-sm transition-transform",
          checked ? "bg-black" : "bg-white/70",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

function SegmentedChoice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/[0.09] bg-black/25 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            "rounded-full px-3 py-1.5 text-xs font-bold transition",
            value === option.value ? "bg-white text-black" : "text-white/55 hover:text-white",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "secondary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" ? "border-white bg-white text-black hover:bg-white/88" : "border-white/[0.08] bg-white/[0.055] text-white/78 hover:border-white/15 hover:bg-white/[0.1] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function SourceRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[4rem] min-w-0 flex-col gap-3 rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{title}</div>
        {hint ? <div className="mt-1 line-clamp-2 text-sm leading-5 text-white/42">{hint}</div> : null}
      </div>
      <div className="min-w-0 max-w-full shrink">{children}</div>
    </div>
  );
}

export function SettingsView({
  settings,
  onSettingsChange,
  offlineUsageBytes,
  offlineEpisodeCount,
  onClearOffline,
  onRefreshArtwork,
  artworkRefreshBusy,
  artworkRefreshSummary,
  onExportLibrary,
  onImportLibrary,
  localRuntimeStatus,
  onRefreshLocalRuntime,
  vaultStatus,
  vaultDiagnostics,
  onConnectVault,
  onReconnectVaultAccess,
  onDisconnectVault,
  onResetVaultLink,
  onRefreshVaultStatus,
  providerFeeds,
  integrationCatalog,
  providerRepositoryUrls,
  onToggleProviderFeed,
  onProviderRepositoriesChange,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [folderBusy, setFolderBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [feedModuleId, setFeedModuleId] = useState<string | null>(null);
  const [keyModuleId, setKeyModuleId] = useState<string | null>(null);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [artworkKeysModalOpen, setArtworkKeysModalOpen] = useState(false);
  const [privateSetupModalOpen, setPrivateSetupModalOpen] = useState(false);
  const [repositoryInput, setRepositoryInput] = useState("");
  const [privateNode, setPrivateNode] = useState<PrivateNodeConnection>(() => readPrivateNodeConnection());
  const [privateNodeInput, setPrivateNodeInput] = useState(() => readPrivateNodeConnection().nodeUrl);
  const [privateNodeStatus, setPrivateNodeStatus] = useState<Awaited<ReturnType<typeof fetchPrivateNodeStatus>> | null>(null);
  const [privateAccounts, setPrivateAccounts] = useState<PrivateNodeAccount[]>([]);
  const [privateAccountId, setPrivateAccountId] = useState("");
  const [privateSetupSecret, setPrivateSetupSecret] = useState("");
  const [privateStorage, setPrivateStorage] = useState<PrivateNodeStorageSummary | null>(null);
  const [privateWatcherPassword, setPrivateWatcherPassword] = useState("");
  const [privateNodeBusy, setPrivateNodeBusy] = useState(false);
  const [privateNodeMessage, setPrivateNodeMessage] = useState<string | null>(null);
  const [showPrivateSetup, setShowPrivateSetup] = useState(false);
  const [setupAccountName, setSetupAccountName] = useState("Owner");
  const [setupAccountId, setSetupAccountId] = useState("acct_owner");
  const [setupProfileNames, setSetupProfileNames] = useState("Owner");
  const [setupQuotaGb, setSetupQuotaGb] = useState(500);
  const [setupNodeName, setSetupNodeName] = useState("Home Server");
  const [setupCode, setSetupCode] = useState("");
  const [setupAllowPublicFetch, setSetupAllowPublicFetch] = useState(true);
  const [integrationUserKeys, setIntegrationUserKeys] = useState(() => readIntegrationUserKeys());
  const [integrationUserCredentials, setIntegrationUserCredentials] = useState(() => readIntegrationUserCredentials());
  const [svetLoginModalOpen, setSvetLoginModalOpen] = useState(false);
  const [svetLoginBusy, setSvetLoginBusy] = useState(false);
  const [svetLoginMessage, setSvetLoginMessage] = useState<{ tone: "good" | "warn"; text: string } | null>(null);

  const tabs = [
    { id: "general" as const, label: "General", icon: SlidersHorizontal },
    { id: "storage" as const, label: "Storage", icon: HardDrive },
    { id: "sources" as const, label: "Sources", icon: Rss },
    { id: "private" as const, label: "Private Node", icon: LockKeyhole },
    { id: "advanced" as const, label: "Advanced", icon: PlugZap },
  ];

  const usageMb = Math.round(offlineUsageBytes / (1024 * 1024));
  const usagePercent = Math.min(100, Math.round((usageMb / Math.max(settings.offlineSizeLimitMb, 1)) * 100));
  const offlineCacheTitle =
    usageMb > 0
      ? `${usageMb} MB used`
      : offlineEpisodeCount > 0
        ? `${offlineEpisodeCount} saved ${offlineEpisodeCount === 1 ? "episode" : "episodes"}`
        : "No saved episodes";
  const offlineCacheHint =
    usageMb > 0
      ? `${offlineEpisodeCount} saved ${offlineEpisodeCount === 1 ? "episode" : "episodes"} out of ${settings.offlineSizeLimitMb} MB.`
      : offlineEpisodeCount > 0
        ? "Saved in the vault. File size is not stored for these older downloads yet."
        : "Nothing is saved in the vault or browser cache.";
  const connectionModeLabel = getConnectionModeLabel(localRuntimeStatus);
  const isDesktopHelper =
    localRuntimeStatus.available &&
    (localRuntimeStatus.transport === "native" ||
      localRuntimeStatus.transport === "direct" ||
      localRuntimeStatus.transport === "node" ||
      localRuntimeStatus.transport === "extension");
  const isFetchServer = localRuntimeStatus.available && localRuntimeStatus.transport === "fetch-server";
  const helperTitle = isFetchServer ? "Fetch server" : "Desktop helper";
  const helperHint = isDesktopHelper
    ? "Ready for local playback and downloads."
    : isFetchServer
      ? "Connected through a public fetch node, not your desktop helper."
      : "Not found on this device.";
  const helperStatus = isDesktopHelper ? "Connected" : isFetchServer ? "Fetch server" : "Not found";
  const connectionReady = ["ready", "read_error", "write_error"].includes(vaultStatus.code);
  const resolvedFolderName = vaultStatus.folderName ?? null;

  const folderStateLabel =
    vaultStatus.code === "unsupported"
      ? "Not supported"
      : vaultStatus.code === "disconnected"
        ? "Not connected"
        : vaultStatus.code === "stored_handle_needs_access"
          ? "Needs access"
          : vaultStatus.code === "read_error"
            ? "Read issue"
            : vaultStatus.code === "write_error"
              ? "Save issue"
              : "Ready";

  const folderStateHint =
    vaultStatus.code === "unsupported"
      ? "This browser cannot link folders."
      : vaultStatus.code === "disconnected"
        ? "Choose a folder for downloads and library data."
        : vaultStatus.code === "stored_handle_needs_access"
          ? "The browser needs permission again."
          : vaultStatus.code === "read_error"
            ? "Linked, but reading failed last time."
            : vaultStatus.code === "write_error"
              ? "Linked, but saving failed last time."
              : "Linked and ready.";

  const seriesOptions = useMemo(
    () => INTEGRATIONS.filter((integration) => integration.kind === "mixed" || integration.kind === "series"),
    [],
  );
  const movieOptions = useMemo(
    () => INTEGRATIONS.filter((integration) => integration.kind === "mixed" || integration.kind === "movies"),
    [],
  );
  const feedsByProvider = useMemo(() => {
    const grouped = new Map<string, ProviderFeedCatalogEntry[]>();
    for (const feed of providerFeeds) {
      grouped.set(feed.moduleId, [...(grouped.get(feed.moduleId) ?? []), feed]);
    }
    return grouped;
  }, [providerFeeds]);

  const installedIntegrations = useMemo(
    () => integrationCatalog.filter((integration) => integration.status !== "disabled"),
    [integrationCatalog],
  );
  const selectedFeedModule = feedModuleId ? installedIntegrations.find((module) => module.id === feedModuleId) : null;
  const selectedKeyModule = keyModuleId ? installedIntegrations.find((module) => module.id === keyModuleId) : null;
  const selectedModuleFeeds = feedModuleId ? (feedsByProvider.get(feedModuleId) ?? []) : [];
  useEffect(() => {
    if (privateAccounts.length > 0 && !privateAccountId) {
      setPrivateAccountId(privateAccounts[0].accountId);
    }
  }, [privateAccountId, privateAccounts]);

  useEffect(() => {
    if (!privateNode.nodeUrl) {
      return;
    }
    let canceled = false;
    void fetchPrivateNodeStatus(privateNode.nodeUrl)
      .then(async (status) => {
        const accounts = status.auth?.setupRequired && !status.auth.privateAuthEnabled ? [] : await fetchPrivateNodeAccounts(privateNode.nodeUrl);
        return [status, accounts] as const;
      })
      .then(([status, accounts]) => {
        if (canceled) {
          return;
        }
        setPrivateNodeStatus(status);
        setPrivateAccounts(accounts);
        setPrivateAccountId((current) => current || privateNode.accountId || accounts[0]?.accountId || "");
        if (status.auth?.setupRequired) {
          setShowPrivateSetup(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setPrivateNodeStatus(null);
        }
      });
    return () => {
      canceled = true;
    };
  }, [privateNode.accountId, privateNode.nodeUrl]);

  useEffect(() => {
    if (!privateNode.nodeUrl || !privateNode.token) {
      setPrivateStorage(null);
      return;
    }
    let canceled = false;
    void fetchPrivateNodeStorage(privateNode.nodeUrl, privateNode.token)
      .then((summary) => {
        if (!canceled) {
          setPrivateStorage(summary);
        }
      })
      .catch(() => {
        if (!canceled) {
          setPrivateStorage(null);
        }
      });
    return () => {
      canceled = true;
    };
  }, [privateNode.nodeUrl, privateNode.token]);

  async function runFolderAction(action: () => Promise<void>, fallback: string) {
    setFolderBusy(true);
    try {
      await action();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : fallback);
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleImportSnapshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportBusy(true);
    try {
      await onImportLibrary(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to import backup.");
    } finally {
      setImportBusy(false);
      event.target.value = "";
    }
  }

  function handleSetPreferredSource(key: "preferredSeriesSource" | "preferredMovieSource", value: IntegrationId) {
    onSettingsChange({ [key]: value } as Partial<LibrarySettings>);
  }

  function addProviderRepository() {
    const value = repositoryInput.trim().replace(/\/+$/, "");
    if (!value || providerRepositoryUrls.includes(value)) {
      return;
    }
    onProviderRepositoriesChange([...providerRepositoryUrls, value]);
    setRepositoryInput("");
  }

  function updateIntegrationUserKey(integrationId: string, value: string) {
    setIntegrationUserKeys((current) => {
      const next = {
        ...current,
        [integrationId]: value,
      };
      if (!value.trim()) {
        delete next[integrationId];
      }
      writeIntegrationUserKeys(next);
      return next;
    });
  }

  function updateIntegrationUserCredential(integrationId: string, field: "username" | "password", value: string) {
    setIntegrationUserCredentials((current) => {
      const existing = current[integrationId] ?? {};
      const nextCredentials = {
        ...existing,
        [field]: value,
      };
      const next = {
        ...current,
        [integrationId]: nextCredentials,
      };
      if (!nextCredentials.username?.trim() && !nextCredentials.password) {
        delete next[integrationId];
      }
      writeIntegrationUserCredentials(next);
      return next;
    });
  }

  function clearIntegrationUserCredentials(integrationId: string) {
    setIntegrationUserCredentials((current) => {
      const next = { ...current };
      delete next[integrationId];
      writeIntegrationUserCredentials(next);
      return next;
    });
  }

  async function verifyStoredSvetLogin() {
    const credentials = integrationUserCredentials.svetserialu ?? {};
    setSvetLoginBusy(true);
    setSvetLoginMessage(null);
    try {
      await verifySvetSerialuLogin(credentials);
      setSvetLoginMessage({ tone: "good", text: "Login verified." });
    } catch (error) {
      setSvetLoginMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "SvetSerialu login failed.",
      });
    } finally {
      setSvetLoginBusy(false);
    }
  }

  function renderFolderActions() {
    if (!isFolderConnectionSupported()) {
      return <StatusPill tone="warn">Unavailable</StatusPill>;
    }

    if (vaultStatus.code === "disconnected") {
      return (
        <ActionButton
          variant="primary"
          disabled={folderBusy}
          onClick={() => void runFolderAction(onConnectVault, "Folder connection failed.")}
        >
          <FolderOpen className="h-4 w-4" />
          {folderBusy ? "Connecting" : "Choose folder"}
        </ActionButton>
      );
    }

    if (vaultStatus.code === "stored_handle_needs_access") {
      return (
        <div className="flex flex-wrap justify-end gap-2">
          <ActionButton
            variant="primary"
            disabled={folderBusy}
            onClick={() => void runFolderAction(onReconnectVaultAccess, "Failed to restore folder access.")}
          >
            Restore access
          </ActionButton>
          <ActionButton
            disabled={folderBusy}
            onClick={() => void runFolderAction(onResetVaultLink, "Failed to reset folder link.")}
          >
            Reset
          </ActionButton>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton
          disabled={folderBusy}
          onClick={() => void runFolderAction(onConnectVault, "Folder connection failed.")}
        >
          Change
        </ActionButton>
        <ActionButton
          disabled={folderBusy}
          onClick={() => void runFolderAction(onDisconnectVault, "Failed to disconnect folder.")}
        >
          Disconnect
        </ActionButton>
      </div>
    );
  }

  async function handleConnectPrivateNode() {
    const nodeUrl = privateNodeInput.trim().replace(/\/+$/, "");
    if (!nodeUrl) {
      setPrivateNodeMessage("Enter a private node URL.");
      return;
    }
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      const status = await fetchPrivateNodeStatus(nodeUrl);
      let accounts: PrivateNodeAccount[] = [];
      if (!status.auth?.setupRequired || status.auth.privateAuthEnabled) {
        accounts = await fetchPrivateNodeAccounts(nodeUrl);
      }
      setPrivateNodeStatus(status);
      setPrivateAccounts(accounts);
      setPrivateAccountId((current) => current || accounts[0]?.accountId || "");
      const next = writePrivateNodeConnection({
        ...privateNode,
        nodeUrl,
      });
      setPrivateNode(next);
      if (status.auth?.setupRequired) {
        setShowPrivateSetup(false);
        setPrivateNodeMessage("Node found. Open Setup to enter the terminal verification code.");
      } else {
        setPrivateNodeMessage(status.auth?.privateAuthEnabled ? "Private node connected." : "Node found, but private auth is not enabled.");
      }
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Failed to connect private node.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  async function handleFindPrivateNode() {
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      const candidates = await findPrivateNodeCandidates(localRuntimeStatus.origin ? [localRuntimeStatus.origin] : []);
      const candidate = candidates.find((entry) => entry.status.auth?.setupRequired)
        ?? candidates.find((entry) => entry.status.auth?.privateAuthEnabled)
        ?? candidates[0];
      if (!candidate) {
        setPrivateNodeMessage("No private node found. Start the server with npm run start:server, then try again.");
        return;
      }
      let accounts: PrivateNodeAccount[] = [];
      if (!candidate.status.auth?.setupRequired || candidate.status.auth.privateAuthEnabled) {
        accounts = await fetchPrivateNodeAccounts(candidate.nodeUrl);
      }
      setPrivateNodeInput(candidate.nodeUrl);
      setPrivateNodeStatus(candidate.status);
      setPrivateAccounts(accounts);
      setPrivateAccountId((current) => current || accounts[0]?.accountId || "");
      setPrivateNode(writePrivateNodeConnection({ ...privateNode, nodeUrl: candidate.nodeUrl }));
      if (candidate.status.auth?.setupRequired) {
        setShowPrivateSetup(false);
        setPrivateNodeMessage("Found a server waiting for setup. Open Setup to enter the terminal verification code.");
      } else {
        setPrivateNodeMessage("Private node found.");
      }
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Failed to find private node.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  function persistPrivateLogin(input: {
    nodeUrl: string;
    token: string;
    refreshToken: string;
    account: { accountId: string; displayName: string };
    profiles: Array<{ profileId: string; displayName: string }>;
    session: { profileId?: string | null };
  }) {
    const profileId = input.session.profileId ?? input.profiles[0]?.profileId ?? null;
    const profileName = input.profiles.find((profile) => profile.profileId === profileId)?.displayName ?? null;
    const next = writePrivateNodeConnection({
      nodeUrl: input.nodeUrl,
      token: input.token,
      refreshToken: input.refreshToken,
      accountId: input.account.accountId,
      profileId,
      accountName: input.account.displayName,
      profileName,
    });
    setPrivateNode(next);
    setPrivateSetupSecret("");
    setPrivateNodeMessage("Signed in to private node.");
  }

  async function handleEnrollPrivatePasskey() {
    if (!privateNode.nodeUrl || !privateAccountId || !privateSetupSecret) {
      setPrivateNodeMessage("Connect a node, choose an account, and enter the setup secret.");
      return;
    }
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      persistPrivateLogin({
        nodeUrl: privateNode.nodeUrl,
        ...(await enrollPrivateNodePasskey({
          nodeUrl: privateNode.nodeUrl,
          accountId: privateAccountId,
          setupSecret: privateSetupSecret,
        })),
      });
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Passkey enrollment failed.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  async function handleLoginPrivatePasskey() {
    if (!privateNode.nodeUrl || !privateAccountId) {
      setPrivateNodeMessage("Connect a node and choose an account.");
      return;
    }
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      persistPrivateLogin({
        nodeUrl: privateNode.nodeUrl,
        ...(await loginPrivateNodePasskey({
          nodeUrl: privateNode.nodeUrl,
          accountId: privateAccountId,
          profileId: privateNode.profileId,
        })),
      });
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Passkey login failed.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  async function handleLoginPrivatePassword() {
    if (!privateNode.nodeUrl || !privateAccountId || !privateWatcherPassword) {
      setPrivateNodeMessage("Connect a node, choose a watcher, and enter the password.");
      return;
    }
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      persistPrivateLogin({
        nodeUrl: privateNode.nodeUrl,
        ...(await loginWatcherNodePassword({
          nodeUrl: privateNode.nodeUrl,
          watcherId: privateAccountId,
          password: privateWatcherPassword,
          profileId: privateNode.profileId,
        })),
      });
      setPrivateWatcherPassword("");
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Password login failed.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  async function handleSelectPrivateProfile(profileId: string) {
    if (!privateNode.nodeUrl || !privateNode.token) {
      return;
    }
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      persistPrivateLogin({
        nodeUrl: privateNode.nodeUrl,
        ...(await selectPrivateNodeProfile({
          nodeUrl: privateNode.nodeUrl,
          token: privateNode.token,
          profileId,
        })),
      });
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Profile switch failed.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  function handleLogoutPrivateNode() {
    const previousConnection = privateNode;
    const next = clearPrivateNodeConnection();
    setPrivateNode(next);
    setPrivateNodeInput("");
    setPrivateNodeStatus(null);
    setPrivateAccounts([]);
    setPrivateAccountId("");
    setPrivateStorage(null);
    setPrivateNodeMessage("Logged out of the private node.");
    void logoutPrivateNode(previousConnection).catch(() => undefined);
  }

  async function handleCompletePrivateSetup() {
    const nodeUrl = privateNode.nodeUrl || privateNodeInput.trim().replace(/\/+$/, "");
    if (!nodeUrl || !setupCode.trim()) {
      setPrivateNodeMessage("Connect the node and enter the setup code from the terminal.");
      return;
    }
    if (privateNodeStatus?.auth?.privateAuthEnabled) {
      if (!privateAccountId) {
        setPrivateNodeMessage("Choose the account to enroll.");
        return;
      }
      setPrivateNodeBusy(true);
      setPrivateNodeMessage(null);
      try {
        persistPrivateLogin({
          nodeUrl,
          ...(await enrollPrivateNodePasskey({
            nodeUrl,
            accountId: privateAccountId,
            setupSecret: setupCode,
          })),
        });
        const status = await fetchPrivateNodeStatus(nodeUrl);
        setPrivateNodeStatus(status);
        setShowPrivateSetup(false);
      } catch (error) {
        setPrivateNodeMessage(error instanceof Error ? error.message : "Passkey enrollment failed.");
      } finally {
        setPrivateNodeBusy(false);
      }
      return;
    }
    setPrivateNodeBusy(true);
    setPrivateNodeMessage(null);
    try {
      await fetchPrivateNodeSetupStatus(nodeUrl);
      const profileNames = setupProfileNames
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 8);
      const profiles = (profileNames.length > 0 ? profileNames : [setupAccountName.trim() || "Owner"]).map((displayName, index) => ({
        profileId: `prof_${displayName.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_") || index + 1}`,
        displayName,
        avatar: "default",
      }));
      const setup = await completePrivateNodeSetup({
        nodeUrl,
        setupCode,
        nodeName: setupNodeName,
        admin: {
          adminId: "admin",
          displayName: "Admin",
          password: setupCode.padEnd(10, "0"),
        },
        publicCapabilities: {
          fetch: setupAllowPublicFetch,
          search: setupAllowPublicFetch,
          import: setupAllowPublicFetch,
          stream: setupAllowPublicFetch,
          download: setupAllowPublicFetch,
          spillshare: false,
          relay: false,
        },
        initialWatchers: [{
          watcherId: setupAccountId.replace(/^acct_/, "watcher_"),
          displayName: setupAccountName,
          quotaBytes: Math.max(1, Math.round(setupQuotaGb)) * 1024 * 1024 * 1024,
          profiles,
        }],
      });
      const status = await fetchPrivateNodeStatus(nodeUrl);
      setPrivateNodeStatus(status);
      setPrivateAccounts(setup.accounts);
      setPrivateAccountId(setup.accounts[0]?.accountId || "");
      setPrivateSetupSecret("");
      setPrivateNode(writePrivateNodeConnection({ ...privateNode, nodeUrl }));
      setPrivateNodeMessage("Private node configured. Enroll your passkey with the setup code now.");
    } catch (error) {
      setPrivateNodeMessage(error instanceof Error ? error.message : "Private node setup failed.");
    } finally {
      setPrivateNodeBusy(false);
    }
  }

  return (
    <div className="relative z-10 animate-fade-in px-4 pb-28 pt-4 sm:px-6 sm:py-7 sm:pb-24 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-col gap-4 border-b border-white/[0.07] pb-5 sm:mb-7 sm:gap-5 sm:pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Spilled preferences</div>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.035em] text-white sm:mt-2 sm:text-4xl">Settings</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/42">Playback, storage, sources, and private infrastructure in one place.</p>
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition",
                  activeTab === tab.id ? "border-white bg-white text-black" : "border-white/[0.07] bg-white/[0.035] text-white/52 hover:border-white/15 hover:bg-white/[0.07] hover:text-white",
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </header>

        {activeTab === "general" ? (
          <div className="grid gap-4">
            <Panel title="Watching">
              <PreferenceRow title="Autoplay next episode" hint="Continue to the next saved episode when playback ends.">
                <Toggle
                  label="Toggle autoplay"
                  checked={settings.autoplayNext}
                  onToggle={() => onSettingsChange({ autoplayNext: !settings.autoplayNext })}
                />
              </PreferenceRow>
              <PreferenceRow title="Download engine" hint="Use the desktop helper for full downloads or keep downloads browser-only.">
                <SegmentedChoice<DownloadEngine>
                  value={settings.downloadEngine}
                  options={[
                    { value: "localffmpeg", label: "Desktop" },
                    { value: "wasm", label: "Browser" },
                  ]}
                  onChange={(downloadEngine) => onSettingsChange({ downloadEngine })}
                />
              </PreferenceRow>
              <PreferenceRow title={helperTitle} hint={helperHint}>
                <div className="flex items-center justify-end gap-2">
                  <StatusPill tone={isDesktopHelper ? "good" : isFetchServer ? "neutral" : "warn"}>
                    {helperStatus}
                  </StatusPill>
                  <ActionButton onClick={onRefreshLocalRuntime}>
                    <RefreshCw className="h-4 w-4" />
                    Check
                  </ActionButton>
                </div>
              </PreferenceRow>
            </Panel>

            <Panel title="Defaults" hint="These decide which provider is tried first when there are multiple choices.">
              <PreferenceRow title="Series source">
                <SegmentedChoice<IntegrationId>
                  value={settings.preferredSeriesSource}
                  options={seriesOptions.map((integration) => ({ value: integration.id, label: integration.name }))}
                  onChange={(value) => handleSetPreferredSource("preferredSeriesSource", value)}
                />
              </PreferenceRow>
              <PreferenceRow title="Movie source">
                <SegmentedChoice<IntegrationId>
                  value={settings.preferredMovieSource}
                  options={movieOptions.map((integration) => ({ value: integration.id, label: integration.name }))}
                  onChange={(value) => handleSetPreferredSource("preferredMovieSource", value)}
                />
              </PreferenceRow>
            </Panel>
          </div>
        ) : null}

        {activeTab === "storage" ? (
          <div className="grid gap-4">
            <Panel title="Library folder">
              <PreferenceRow title={resolvedFolderName ?? folderStateLabel} hint={folderStateHint}>
                <div className="flex items-center justify-end gap-2">
                  <StatusPill tone={connectionReady ? "good" : "warn"}>{folderStateLabel}</StatusPill>
                  {renderFolderActions()}
                </div>
              </PreferenceRow>
              <PreferenceRow title="Refresh folder status" hint="Re-check the linked folder without changing it.">
                <ActionButton onClick={() => void onRefreshVaultStatus()}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </ActionButton>
              </PreferenceRow>
            </Panel>

            <Panel title="Offline cache">
              <PreferenceRow title="Cache limit" hint="Maximum space the app should use for downloaded episodes.">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <SegmentedChoice<number>
                    value={settings.offlineSizeLimitMb}
                    options={[
                      { value: 512, label: "512 MB" },
                      { value: 2048, label: "2 GB" },
                      { value: 8192, label: "8 GB" },
                    ]}
                    onChange={(offlineSizeLimitMb) => onSettingsChange({ offlineSizeLimitMb })}
                  />
                  <input
                    type="number"
                    min={128}
                    step={128}
                    value={settings.offlineSizeLimitMb}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(value)) {
                        onSettingsChange({ offlineSizeLimitMb: Math.max(128, value) });
                      }
                    }}
                    className="h-10 w-28 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none"
                    aria-label="Custom cache limit in MB"
                  />
                </div>
              </PreferenceRow>
              <PreferenceRow
                title={offlineCacheTitle}
                hint={offlineCacheHint}
              >
                <div className="flex min-w-56 items-center justify-end gap-3">
                  {usageMb > 0 ? (
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-black/50">
                      <div className="h-full rounded-full bg-orange-500" style={{ width: `${usagePercent}%` }} />
                    </div>
                  ) : offlineEpisodeCount > 0 ? (
                    <StatusPill tone="good">Vault</StatusPill>
                  ) : null}
                  <ActionButton onClick={onClearOffline}>Clear</ActionButton>
                </div>
              </PreferenceRow>
            </Panel>

            <Panel title="Backup">
              <PreferenceRow title="Library backup" hint="Export or restore the local library snapshot.">
                <div className="flex flex-wrap justify-end gap-2">
                  <ActionButton variant="primary" onClick={onExportLibrary}>
                    <Download className="h-4 w-4" />
                    Export
                  </ActionButton>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/18">
                    <Upload className="h-4 w-4" />
                    {importBusy ? "Importing" : "Import"}
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        void handleImportSnapshot(event);
                      }}
                    />
                  </label>
                </div>
              </PreferenceRow>
            </Panel>
          </div>
        ) : null}

        {activeTab === "sources" ? (
          <div className="grid gap-3">
            <Panel title="Integrations" hint="Repository-loaded integrations. Artwork controls use shared keys unless a local key is configured.">
              {installedIntegrations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/16 px-4 py-5 text-sm leading-6 text-white/45">
                  No integrations are installed yet. Refresh the default connector repository or add another repository below.
                </div>
              ) : (
                <div className="grid gap-3">
                  {installedIntegrations.map((integration) => {
                  const feeds = feedsByProvider.get(integration.id) ?? [];
                  const enabledCount = feeds.filter((feed) => feed.enabled).length;
                  const visibleCapabilities = integration.capabilities.filter((capability) =>
                    ["search", "discovery", "metadata", "artwork", "import", "players", "subtitles", "downloads"].includes(capability),
                  );
                  const isArtworkIntegration = integration.id === "tmdb" || integration.id === "fanart" || integration.id === "tvdb";
                  const artworkKey = isArtworkIntegration ? integration.id as "tmdb" | "fanart" | "tvdb" : null;
                  const hasUserKey = integration.credentialRequirements?.some((requirement) => requirement.kind === "userApiKey") ?? false;
                  const hasSiteLogin = integration.credentialRequirements?.some((requirement) => requirement.kind === "siteLogin") ?? false;
                  const siteLogin = integrationUserCredentials[integration.id];
                  return (
                    <SourceRow
                      key={integration.id}
                      title={integration.displayName}
                      hint={`${integration.id} · v${integration.version}`}
                    >
                      <div className="flex max-w-full flex-wrap justify-start gap-1.5 sm:justify-end">
                          <StatusPill tone={integration.status === "stable" ? "good" : undefined}>{integration.status}</StatusPill>
                          {visibleCapabilities.slice(0, 4).map((capability) => (
                            <StatusPill key={capability}>{capability}</StatusPill>
                          ))}
                          {visibleCapabilities.length > 4 ? <StatusPill>+{visibleCapabilities.length - 4}</StatusPill> : null}
                          {integration.credentialRequirements?.some((requirement) => requirement.kind === "sharedAppKey") ? (
                            <StatusPill tone="good">Shared</StatusPill>
                          ) : null}
                          {hasUserKey || hasSiteLogin ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (hasSiteLogin) {
                                  setSvetLoginMessage(null);
                                  setSvetLoginModalOpen(true);
                                } else {
                                  setKeyModuleId(integration.id);
                                }
                              }}
                              className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/70 transition-colors hover:bg-white/18 hover:text-white"
                            >
                              {hasSiteLogin
                                ? (siteLogin?.username?.trim() && siteLogin.password ? "Login set" : "Login")
                                : (integrationUserKeys[integration.id]?.trim() ? "Key set" : "Key")}
                            </button>
                          ) : null}
                          {feeds.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setFeedModuleId(integration.id)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-white/18"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Feeds {enabledCount > 0 ? `${enabledCount}/${feeds.length}` : feeds.length}
                            </button>
                          ) : null}
                          {artworkKey ? (
                            <Toggle
                              label={`Toggle ${integration.displayName}`}
                              checked={settings.artworkSources[artworkKey]}
                              onToggle={() =>
                                onSettingsChange({
                                  artworkSources: {
                                    ...settings.artworkSources,
                                    [artworkKey]: !settings.artworkSources[artworkKey],
                                  },
                                })
                              }
                            />
                          ) : null}
                      </div>
                    </SourceRow>
                  );
                  })}
                  <SourceRow
                    title="SvetSerialu login"
                    hint="Required by svetserialu.to before Spilled can search or import from it."
                  >
                    <div className="flex flex-wrap justify-end gap-2">
                      {integrationUserCredentials.svetserialu?.username?.trim() && integrationUserCredentials.svetserialu?.password ? (
                        <StatusPill tone="good">Saved</StatusPill>
                      ) : (
                        <StatusPill tone="warn">Required</StatusPill>
                      )}
                      <ActionButton
                        onClick={() => {
                          setSvetLoginMessage(null);
                          setSvetLoginModalOpen(true);
                        }}
                      >
                        <LockKeyhole className="h-4 w-4" />
                        Login
                      </ActionButton>
                    </div>
                  </SourceRow>
                  <SourceRow title="Artwork API keys" hint="Configure TMDB, Fanart, and TVDB API keys for artwork fetching.">
                    <ActionButton onClick={() => setArtworkKeysModalOpen(true)}>
                      <Key className="h-4 w-4" />
                      Keys
                    </ActionButton>
                  </SourceRow>
                  <SourceRow title="Refresh existing artwork" hint={artworkRefreshSummary ?? "Update covers, backdrops, and logos for imported titles."}>
                    <ActionButton
                      variant="primary"
                      disabled={artworkRefreshBusy}
                      onClick={() => void onRefreshArtwork()}
                    >
                      <ImageIcon className="h-4 w-4" />
                      {artworkRefreshBusy ? "Refreshing" : "Refresh"}
                    </ActionButton>
                  </SourceRow>
                </div>
              )}
            </Panel>

            <Panel title="Connector repositories" hint={`${providerRepositoryUrls.length} source(s), including the default repository.`}>
              <div className="flex flex-wrap gap-2">
                <ActionButton variant="primary" onClick={() => setRepositoryModalOpen(true)}><Plus className="h-4 w-4" />Manage</ActionButton>
                <ActionButton onClick={() => onProviderRepositoriesChange(providerRepositoryUrls)}><RefreshCw className="h-4 w-4" />Refresh</ActionButton>
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === "private" ? (
          <div className="grid gap-4">
            <Panel title="Private node" hint="Connect with the code shown by Spilled Server. Your node URL is no longer required.">
              <PreferenceRow title="Secure connection" hint="Locate your node by code and sign in over the encrypted gateway.">
                <a href="/connect" className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-black text-black">
                  Connect or sign in
                </a>
              </PreferenceRow>
              <PreferenceRow title="Find server" hint="Looks for your running node through local/native runtime and registered fetch nodes.">
                <ActionButton disabled={privateNodeBusy} variant="primary" onClick={() => void handleFindPrivateNode()}>
                  <Terminal className="h-4 w-4" />
                  {privateNodeBusy ? "Finding" : "Find server"}
                </ActionButton>
              </PreferenceRow>
              <PreferenceRow title="Legacy node URL" hint="Advanced fallback for older server builds only.">
                <div className="flex min-w-[min(34rem,100%)] flex-col gap-2 sm:flex-row">
                  <input
                    value={privateNodeInput}
                    onChange={(event) => setPrivateNodeInput(event.target.value)}
                    placeholder="https://your-private-node.example.com"
                    className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                  />
                  <ActionButton disabled={privateNodeBusy} variant="primary" onClick={() => void handleConnectPrivateNode()}>
                    {privateNodeBusy ? "Checking" : "Connect"}
                  </ActionButton>
                </div>
              </PreferenceRow>
              <PreferenceRow title="Status" hint={privateNodeStatus?.auth?.privateAuthEnabled ? "Private auth is available on this node." : "Connect to a private node to see auth support."}>
                <div className="flex flex-wrap justify-end gap-2">
                  <StatusPill tone={privateNodeStatus ? "good" : "neutral"}>{privateNodeStatus ? "Found" : "Not connected"}</StatusPill>
                  {privateNodeStatus?.node?.mode === "full" ? <StatusPill tone="good">Private + fetch</StatusPill> : null}
                  {privateNodeStatus?.auth?.passkeysEnabled ? <StatusPill tone="good">Passkeys</StatusPill> : null}
                  {privateNodeStatus?.auth?.oidcProviders?.length ? <StatusPill>{privateNodeStatus.auth.oidcProviders.length} SSO</StatusPill> : null}
                  {privateNodeStatus?.auth?.setupRequired ? (
                    <a className="rounded-full bg-white px-4 py-2 text-sm font-bold text-black" href={`/node/setup${privateNode.nodeUrl ? `?node=${encodeURIComponent(privateNode.nodeUrl)}` : ""}`}>
                      Setup
                    </a>
                  ) : null}
                  {privateNodeStatus?.auth?.privateAuthEnabled ? (
                    <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white" href={`/node/admin${privateNode.nodeUrl ? `?node=${encodeURIComponent(privateNode.nodeUrl)}` : ""}`}>
                      Manage server
                    </a>
                  ) : null}
                </div>
              </PreferenceRow>
              {privateNodeMessage ? (
                <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/55">
                  {privateNodeMessage}
                </div>
              ) : null}
            </Panel>

            {showPrivateSetup ? (
              <Panel title="Setup private node" hint="A new node is waiting for initial setup.">
                <div className="flex justify-end">
                  <ActionButton variant="primary" onClick={() => setPrivateSetupModalOpen(true)}>Begin setup</ActionButton>
                </div>
              </Panel>
            ) : null}

            {privateSetupModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#141519] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">Private Node</div>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">Setup</h3>
                </div>
                <button type="button" onClick={() => setPrivateSetupModalOpen(false)} className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/18 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Panel title="Setup private node" hint="Enter the verification code printed by the server terminal, then create the admin account and choose public capabilities.">
                <div className="grid gap-3 md:grid-cols-2">
                  <SourceRow title="Setup code" hint="Printed by the server terminal after it starts.">
                    <input
                      value={setupCode}
                      onChange={(event) => setSetupCode(event.target.value.toUpperCase())}
                      placeholder="ABC123"
                      className="h-10 w-36 rounded-full border border-white/10 bg-black/30 px-4 text-sm font-bold uppercase tracking-[0.18em] text-white outline-none placeholder:text-white/28"
                    />
                  </SourceRow>
                  {privateNodeStatus?.auth?.privateAuthEnabled && privateAccounts.length > 0 ? (
                    <SourceRow title="Account" hint="Choose where to enroll the first passkey.">
                      <select
                        value={privateAccountId}
                        onChange={(event) => setPrivateAccountId(event.target.value)}
                        className="h-10 rounded-full border border-white/10 bg-black/40 px-4 text-sm text-white outline-none"
                      >
                        {privateAccounts.map((account) => (
                          <option key={account.accountId} value={account.accountId}>
                            {account.displayName}
                          </option>
                        ))}
                      </select>
                    </SourceRow>
                  ) : null}
                  {!privateNodeStatus?.auth?.privateAuthEnabled ? <SourceRow title="Node name" hint="Shown in status and discovery.">
                    <input
                      value={setupNodeName}
                      onChange={(event) => setSetupNodeName(event.target.value)}
                      className="h-10 w-48 rounded-full border border-white/10 bg-black/30 px-4 text-sm text-white outline-none"
                    />
                  </SourceRow> : null}
                  {!privateNodeStatus?.auth?.privateAuthEnabled ? <SourceRow title="Admin account" hint="The local account configured on your server.">
                    <input
                      value={setupAccountName}
                      onChange={(event) => {
                        setSetupAccountName(event.target.value);
                        if (!setupAccountId || setupAccountId === "acct_owner") {
                          setSetupAccountId(`acct_${event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_") || "owner"}`);
                        }
                      }}
                      className="h-10 w-48 rounded-full border border-white/10 bg-black/30 px-4 text-sm text-white outline-none"
                    />
                  </SourceRow> : null}
                  {!privateNodeStatus?.auth?.privateAuthEnabled ? <SourceRow title="Account id" hint="Stable id stored in the private config.">
                    <input
                      value={setupAccountId}
                      onChange={(event) => setSetupAccountId(event.target.value)}
                      className="h-10 w-48 rounded-full border border-white/10 bg-black/30 px-4 text-sm text-white outline-none"
                    />
                  </SourceRow> : null}
                  {!privateNodeStatus?.auth?.privateAuthEnabled ? <SourceRow title="Profiles" hint="Comma-separated profile names.">
                    <input
                      value={setupProfileNames}
                      onChange={(event) => setSetupProfileNames(event.target.value)}
                      className="h-10 w-56 rounded-full border border-white/10 bg-black/30 px-4 text-sm text-white outline-none"
                    />
                  </SourceRow> : null}
                  {!privateNodeStatus?.auth?.privateAuthEnabled ? <SourceRow title="Quota" hint="Shared account storage in GB.">
                    <input
                      type="number"
                      min={1}
                      value={setupQuotaGb}
                      onChange={(event) => setSetupQuotaGb(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
                      className="h-10 w-32 rounded-full border border-white/10 bg-black/30 px-4 text-sm text-white outline-none"
                    />
                  </SourceRow> : null}
                  {!privateNodeStatus?.auth?.privateAuthEnabled ? <SourceRow title="Public fetch" hint="Let this server help with search, imports, streams, and downloads for browser users.">
                    <Toggle
                      label="Toggle public fetch capabilities"
                      checked={setupAllowPublicFetch}
                      onToggle={() => setSetupAllowPublicFetch((current) => !current)}
                    />
                  </SourceRow> : null}
                </div>
                <div className="mt-4 flex justify-end">
                  <ActionButton disabled={privateNodeBusy} variant="primary" onClick={() => void handleCompletePrivateSetup()}>
                    {privateNodeStatus?.auth?.privateAuthEnabled ? "Enroll passkey" : "Setup node"}
                  </ActionButton>
                </div>
              </Panel>
              </div>
            </div>
            ) : null}

            {privateAccounts.length > 0 && !privateNode.token && !privateNodeStatus?.auth?.setupRequired ? (
              <Panel title="Watcher sign in" hint="Watcher accounts are for profiles, library state, and private downloads. Admin management is separate.">
                <PreferenceRow title="Watcher" hint="Choose the account that owns your profiles.">
                  <select
                    value={privateAccountId}
                    onChange={(event) => setPrivateAccountId(event.target.value)}
                    className="h-10 rounded-full border border-white/10 bg-black/40 px-4 text-sm text-white outline-none"
                  >
                    {privateAccounts.map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.displayName}
                      </option>
                    ))}
                  </select>
                </PreferenceRow>
                <PreferenceRow title="Password" hint="Use the watcher password set during setup or in the Admin page.">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={privateWatcherPassword}
                      onChange={(event) => setPrivateWatcherPassword(event.target.value)}
                      placeholder="Watcher password"
                      className="h-10 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                    />
                    <ActionButton disabled={privateNodeBusy} variant="primary" onClick={() => void handleLoginPrivatePassword()}>
                      Sign in
                    </ActionButton>
                  </div>
                </PreferenceRow>
                <PreferenceRow title="Passkey login" hint="Use an enrolled passkey for this account.">
                  <ActionButton disabled={privateNodeBusy} variant="primary" onClick={() => void handleLoginPrivatePasskey()}>
                    Sign in with passkey
                  </ActionButton>
                </PreferenceRow>
                <PreferenceRow title="Enroll passkey" hint="Requires the setup secret from the private server config. The app never stores it.">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={privateSetupSecret}
                      onChange={(event) => setPrivateSetupSecret(event.target.value)}
                      placeholder="Setup secret"
                      className="h-10 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                    />
                    <ActionButton disabled={privateNodeBusy} onClick={() => void handleEnrollPrivatePasskey()}>
                      Enroll
                    </ActionButton>
                  </div>
                </PreferenceRow>
                <PreferenceRow title="SSO" hint="OIDC providers are listed when configured on the private server. Redirect login comes after passkey support.">
                  <div className="flex flex-wrap justify-end gap-2">
                    {(privateNodeStatus?.auth?.oidcProviders ?? []).length === 0 ? (
                      <StatusPill>No providers</StatusPill>
                    ) : (
                      privateNodeStatus?.auth?.oidcProviders?.map((provider) => (
                        <StatusPill key={provider.providerId}>{provider.displayName}</StatusPill>
                      ))
                    )}
                  </div>
                </PreferenceRow>
              </Panel>
            ) : null}

            {privateNode.token ? (
              <Panel title="Signed in">
                <PreferenceRow title={privateNode.accountName ?? "Private account"} hint="This session is signed by your private node.">
                  <div className="flex flex-wrap justify-end gap-2">
                    <StatusPill tone="good">Signed in</StatusPill>
                    <ActionButton onClick={handleLogoutPrivateNode}>Log out</ActionButton>
                  </div>
                </PreferenceRow>
                <PreferenceRow title="Profile" hint="Profiles are separate library views under the same account quota.">
                  <SegmentedChoice<string>
                    value={privateNode.profileId ?? ""}
                    options={(privateAccounts.find((account) => account.accountId === privateNode.accountId)?.profiles ?? [])
                      .map((profile) => ({ value: profile.profileId, label: profile.displayName }))}
                    onChange={(profileId) => void handleSelectPrivateProfile(profileId)}
                  />
                </PreferenceRow>
                <PreferenceRow
                  title="Storage"
                  hint={privateStorage ? `${Math.round(privateStorage.usedBytes / (1024 * 1024))} MB used of ${Math.round(privateStorage.quotaBytes / (1024 * 1024))} MB.` : "Storage summary will appear after sign in."}
                >
                  <StatusPill tone={privateStorage ? "good" : "neutral"}>
                    {privateStorage ? `${Math.round(privateStorage.availableBytes / (1024 * 1024))} MB free` : "Loading"}
                  </StatusPill>
                </PreferenceRow>
                <PreferenceRow title="Library mode" hint="Local stays separate by default. Integrated view and explicit merge will be wired in the next private-library pass.">
                  <StatusPill>Local separate</StatusPill>
                </PreferenceRow>
              </Panel>
            ) : null}
          </div>
        ) : null}

        {selectedFeedModule ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#141519] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">Module feeds</div>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">{selectedFeedModule.displayName}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setFeedModuleId(null)}
                  className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/18 hover:text-white"
                  aria-label="Close feeds"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {selectedModuleFeeds.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/45">
                  This module has no feed adders yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {selectedModuleFeeds.map((feed) => (
                    <SourceRow key={`${feed.moduleId}:${feed.feedId}`} title={feed.title} hint={feed.description}>
                      <button
                        type="button"
                        onClick={() => onToggleProviderFeed(feed.moduleId, feed.feedId)}
                        className={clsx(
                          "rounded-full px-4 py-2.5 text-sm font-semibold transition-colors",
                          feed.enabled ? "bg-white/10 text-white hover:bg-white/18" : "bg-white text-black hover:bg-orange-200",
                        )}
                      >
                        {feed.enabled ? "Remove" : "Add"}
                      </button>
                    </SourceRow>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {artworkKeysModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#141519] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">Artwork</div>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">API Keys</h3>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    Configure your API keys for artwork providers. Leave empty to use shared keys if available.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setArtworkKeysModalOpen(false)}
                  className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/18 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3">
                <input
                  value={integrationUserKeys["tmdb"] ?? ""}
                  onChange={(event) => updateIntegrationUserKey("tmdb", event.target.value)}
                  placeholder="TMDB API Key"
                  type="password"
                  autoComplete="off"
                  className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
                <input
                  value={integrationUserKeys["fanart"] ?? ""}
                  onChange={(event) => updateIntegrationUserKey("fanart", event.target.value)}
                  placeholder="Fanart API Key"
                  type="password"
                  autoComplete="off"
                  className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
                <input
                  value={integrationUserKeys["tvdb"] ?? ""}
                  onChange={(event) => updateIntegrationUserKey("tvdb", event.target.value)}
                  placeholder="TVDB API Key"
                  type="password"
                  autoComplete="off"
                  className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <ActionButton variant="primary" onClick={() => setArtworkKeysModalOpen(false)}>Done</ActionButton>
              </div>
            </div>
          </div>
        ) : null}

        {svetLoginModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#141519] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">Site login</div>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">SvetSerialu</h3>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    Stored locally in this browser and sent only to the fetch runtime for SvetSerialu requests.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSvetLoginModalOpen(false)}
                  className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/18 hover:text-white"
                  aria-label="Close SvetSerialu login"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3">
                <input
                  value={integrationUserCredentials.svetserialu?.username ?? ""}
                  onChange={(event) => {
                    updateIntegrationUserCredential("svetserialu", "username", event.target.value);
                    setSvetLoginMessage(null);
                  }}
                  placeholder="Username or email"
                  type="text"
                  autoComplete="username"
                  className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
                <input
                  value={integrationUserCredentials.svetserialu?.password ?? ""}
                  onChange={(event) => {
                    updateIntegrationUserCredential("svetserialu", "password", event.target.value);
                    setSvetLoginMessage(null);
                  }}
                  placeholder="Password"
                  type="password"
                  autoComplete="current-password"
                  className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
              </div>

              {svetLoginMessage ? (
                <div
                  className={clsx(
                    "mt-4 rounded-2xl border px-4 py-3 text-sm",
                    svetLoginMessage.tone === "good"
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                      : "border-orange-300/20 bg-orange-300/10 text-orange-100",
                  )}
                >
                  {svetLoginMessage.text}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <ActionButton
                  onClick={() => {
                    clearIntegrationUserCredentials("svetserialu");
                    setSvetLoginMessage(null);
                  }}
                >
                  Clear
                </ActionButton>
                <ActionButton
                  disabled={svetLoginBusy}
                  onClick={() => void verifyStoredSvetLogin()}
                >
                  {svetLoginBusy ? "Verifying" : "Verify"}
                </ActionButton>
                <ActionButton variant="primary" onClick={() => setSvetLoginModalOpen(false)}>Done</ActionButton>
              </div>
            </div>
          </div>
        ) : null}

        {selectedKeyModule ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#141519] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">
                    {selectedKeyModule.id === "svetserialu" ? "Site login" : "User API key"}
                  </div>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">{selectedKeyModule.displayName}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    {selectedKeyModule.id === "svetserialu"
                      ? "Stored locally in this browser and sent only to the local fetch runtime."
                      : "Stored locally in this browser. Leave empty to use shared app keys when available."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setKeyModuleId(null)}
                  className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/18 hover:text-white"
                  aria-label="Close API key settings"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedKeyModule.id === "svetserialu" ? (
                <div className="grid gap-3">
                  <input
                    value={integrationUserCredentials.svetserialu?.username ?? ""}
                    onChange={(event) => updateIntegrationUserCredential("svetserialu", "username", event.target.value)}
                    placeholder="Username or email"
                    type="text"
                    autoComplete="username"
                    className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                  />
                  <input
                    value={integrationUserCredentials.svetserialu?.password ?? ""}
                    onChange={(event) => updateIntegrationUserCredential("svetserialu", "password", event.target.value)}
                    placeholder="Password"
                    type="password"
                    autoComplete="current-password"
                    className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                  />
                </div>
              ) : (
                <input
                  value={integrationUserKeys[selectedKeyModule.id] ?? ""}
                  onChange={(event) => updateIntegrationUserKey(selectedKeyModule.id, event.target.value)}
                  placeholder={`${selectedKeyModule.displayName} API key`}
                  type="password"
                  autoComplete="off"
                  className="h-11 w-full rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
              )}
              <div className="mt-4 flex justify-end gap-2">
                <ActionButton
                  onClick={() => {
                    if (selectedKeyModule.id === "svetserialu") {
                      clearIntegrationUserCredentials("svetserialu");
                    } else {
                      updateIntegrationUserKey(selectedKeyModule.id, "");
                    }
                  }}
                >
                  Clear
                </ActionButton>
                <ActionButton variant="primary" onClick={() => setKeyModuleId(null)}>Done</ActionButton>
              </div>
            </div>
          </div>
        ) : null}

        {repositoryModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#141519] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">Connector repositories</div>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">Manage repositories</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setRepositoryModalOpen(false)}
                  className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/18 hover:text-white"
                  aria-label="Close repositories"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={repositoryInput}
                  onChange={(event) => setRepositoryInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      addProviderRepository();
                    }
                  }}
                  placeholder="https://github.com/owner/spilled-connectors"
                  className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/28"
                />
                <ActionButton variant="primary" onClick={addProviderRepository}><Plus className="h-4 w-4" />Add</ActionButton>
                <ActionButton onClick={() => onProviderRepositoriesChange(providerRepositoryUrls)}><RefreshCw className="h-4 w-4" />Refresh</ActionButton>
              </div>
              <div className="mt-4 grid gap-2">
                {providerRepositoryUrls.map((url) => (
                  <SourceRow
                    key={url}
                    title={url}
                    hint={url === DEFAULT_PROVIDER_REPOSITORY_URL ? "Default connector repository" : "Custom connector repository"}
                  >
                    {url === DEFAULT_PROVIDER_REPOSITORY_URL ? (
                      <StatusPill tone="good">Default</StatusPill>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onProviderRepositoriesChange(providerRepositoryUrls.filter((entry) => entry !== url))}
                        className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/18"
                      >
                        Remove
                      </button>
                    )}
                  </SourceRow>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "advanced" ? (
          <div className="grid gap-4">
            <Panel title="Runtime details" hint="Use this when something needs debugging.">
              <PreferenceRow title="Connection mode" hint={connectionModeLabel}>
                <StatusPill tone={isDesktopHelper ? "good" : isFetchServer ? "neutral" : "warn"}>
                  {helperStatus}
                </StatusPill>
              </PreferenceRow>
              <PreferenceRow title="Vault state" hint={folderStateHint}>
                <StatusPill tone={connectionReady ? "good" : "warn"}>{vaultStatus.code}</StatusPill>
              </PreferenceRow>
              <PreferenceRow title="Folder permission" hint={`Stored link: ${vaultStatus.handleStored ? "yes" : "no"}`}>
                <StatusPill>{vaultStatus.permission}</StatusPill>
              </PreferenceRow>
            </Panel>

            <Panel title="Last folder errors">
              {vaultDiagnostics.lastPermissionError || vaultDiagnostics.lastReadError || vaultDiagnostics.lastWriteError ? (
                <div className="space-y-3 text-sm leading-6 text-white/55">
                  {vaultDiagnostics.lastPermissionError ? (
                    <div className="rounded-2xl border border-amber-400/16 bg-amber-500/8 px-4 py-3">
                      Permission: {vaultDiagnostics.lastPermissionError}
                    </div>
                  ) : null}
                  {vaultDiagnostics.lastReadError ? (
                    <div className="rounded-2xl border border-amber-400/16 bg-amber-500/8 px-4 py-3">
                      Read: {vaultDiagnostics.lastReadError}
                    </div>
                  ) : null}
                  {vaultDiagnostics.lastWriteError ? (
                    <div className="rounded-2xl border border-amber-400/16 bg-amber-500/8 px-4 py-3">
                      Write: {vaultDiagnostics.lastWriteError}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/55">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  No recent folder errors.
                </div>
              )}
            </Panel>

            <Panel title="Maintenance">
              <PreferenceRow title="Refresh all checks" hint="Re-run runtime and folder checks.">
                <div className="flex flex-wrap justify-end gap-2">
                  <ActionButton onClick={onRefreshLocalRuntime}>
                    <Package className="h-4 w-4" />
                    Runtime
                  </ActionButton>
                  <ActionButton onClick={() => void onRefreshVaultStatus()}>
                    <DatabaseBackup className="h-4 w-4" />
                    Vault
                  </ActionButton>
                </div>
              </PreferenceRow>
              <PreferenceRow title="Folder warning" hint="This appears only when the folder needs attention.">
                {connectionReady ? (
                  <StatusPill tone="good">Clean</StatusPill>
                ) : (
                  <span className="inline-flex items-center gap-2 text-sm text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                    {folderStateLabel}
                  </span>
                )}
              </PreferenceRow>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
