import type { ChangeEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Rss,
  Settings as SettingsIcon,
  ShieldAlert,
  Tv,
  Upload,
} from "lucide-react";
import { clsx } from "clsx";
import type { DownloadEngine, LibrarySettings, ProviderFeedCatalogEntry } from "../lib/types";
import { INTEGRATIONS, type IntegrationId } from "../lib/integrations";
import type { LocalRuntimeStatus } from "../lib/runtime-bridge";
import { getConnectionModeLabel } from "../lib/runtime-bridge";
import type { VaultDiagnostics, VaultStatus } from "../lib/library-folder";
import { isFolderConnectionSupported } from "../lib/library-folder";

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
  onToggleProviderFeed: (moduleId: string, feedId: string) => void;
};

type SettingsTab = "general" | "storage" | "integrations";

function SectionCard({
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
    <section
      className={clsx(
        "rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.035))] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.18)]",
        className,
      )}
    >
      <div className="mb-4">
        <h4 className="text-base font-semibold tracking-tight text-white">{title}</h4>
        {hint ? <p className="mt-1 text-sm text-white/48">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: "good" | "warn" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em]",
        tone === "good" && "bg-emerald-500/14 text-emerald-200",
        tone === "warn" && "bg-amber-500/14 text-amber-200",
        tone === "neutral" && "bg-white/8 text-white/58",
      )}
    >
      {children}
    </span>
  );
}

function SummaryTile({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: string;
  accent?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">{label}</div>
      <div
        className={clsx(
          "mt-2 text-sm font-semibold",
          accent === "good" && "text-emerald-200",
          accent === "warn" && "text-amber-200",
          accent === "neutral" && "text-white",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onToggle,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium text-white">{title}</div>
        {hint ? <div className="mt-1 text-sm text-white/42">{hint}</div> : null}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={clsx(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-orange-500" : "bg-white/10",
        )}
        aria-pressed={checked}
      >
        <span
          className={clsx(
            "inline-block h-4 w-4 transform rounded-full bg-white transition",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}

function ChoiceButton({
  selected,
  title,
  hint,
  onClick,
}: {
  selected: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-2xl border px-4 py-3 text-left transition-colors",
        selected
          ? "border-orange-400/60 bg-orange-500/10 text-white"
          : "border-white/8 bg-black/20 text-white/72 hover:border-white/16 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        {selected ? <StatusChip tone="good">On</StatusChip> : null}
      </div>
      {hint ? <div className="mt-1 text-sm text-white/42">{hint}</div> : null}
    </button>
  );
}

function IntegrationCard({
  domain,
  shortLabel,
  note,
}: {
  domain: string;
  shortLabel: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-white">{domain}</div>
        <StatusChip tone="good">{shortLabel}</StatusChip>
      </div>
      {note ? <p className="mt-2 text-sm text-white/45">{note}</p> : null}
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
  onToggleProviderFeed,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [folderBusy, setFolderBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const tabs = [
    { id: "general" as const, label: "Watching", icon: Play },
    { id: "storage" as const, label: "Storage", icon: HardDrive },
    { id: "integrations" as const, label: "Sources", icon: Rss },
  ];

  const usageMb = Math.round(offlineUsageBytes / (1024 * 1024));
  const usagePercent = Math.min(100, Math.round((usageMb / Math.max(settings.offlineSizeLimitMb, 1)) * 100));
  const connectionModeLabel = getConnectionModeLabel(localRuntimeStatus);
  const downloadEngines: Array<{ id: DownloadEngine; label: string; note: string }> = [
    {
      id: "localffmpeg",
      label: "Desktop app",
      note: "Best for bigger saves and background downloads.",
    },
    {
      id: "wasm",
      label: "Browser only",
      note: "Works without the desktop app, but is lighter-duty.",
    },
  ];

  const seriesOptions = useMemo(
    () => INTEGRATIONS.filter((integration) => integration.kind === "mixed" || integration.kind === "series"),
    [],
  );
  const movieOptions = useMemo(
    () => INTEGRATIONS.filter((integration) => integration.kind === "mixed" || integration.kind === "movies"),
    [],
  );

  async function handleConnectFolder() {
    setFolderBusy(true);
    try {
      await onConnectVault();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Folder connection failed.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleDisconnectFolder() {
    setFolderBusy(true);
    try {
      await onDisconnectVault();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to disconnect folder.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleReconnectAccess() {
    setFolderBusy(true);
    try {
      await onReconnectVaultAccess();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to restore folder access.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleResetVaultLink() {
    setFolderBusy(true);
    try {
      await onResetVaultLink();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to reset folder link.");
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

  const resolvedFolderName = vaultStatus.folderName ?? null;
  const connectionReady =
    vaultStatus.code === "ready" ||
    vaultStatus.code === "read_error" ||
    vaultStatus.code === "write_error";
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
        ? "Pick a folder to keep downloads and library data together."
        : vaultStatus.code === "stored_handle_needs_access"
          ? "The browser needs permission again."
          : vaultStatus.code === "read_error"
            ? "The folder is linked, but reading failed last time."
            : vaultStatus.code === "write_error"
              ? "The folder is linked, but saving failed last time."
              : "Everything is linked and ready.";

  const connectionShortText = localRuntimeStatus.available ? "Connected" : "Not found";
  const folderShortText = resolvedFolderName ?? folderStateLabel;
  const saveModeShortText = settings.downloadEngine === "localffmpeg" ? "Desktop app" : "Browser only";

  function handleSetPreferredSource(key: "preferredSeriesSource" | "preferredMovieSource", value: IntegrationId) {
    onSettingsChange({ [key]: value } as Partial<LibrarySettings>);
  }

  return (
    <div className="relative z-10 animate-fade-in px-4 py-6 pb-20 lg:px-6">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
          <div className="px-2 pb-4">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/34">Control Room</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">Settings</h2>
          </div>
          <nav className="flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "flex min-w-[8.5rem] items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors lg:min-w-0",
                  activeTab === tab.id
                    ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.14)]"
                    : "bg-white/[0.03] text-white/54 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                <tab.icon className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="space-y-6">
          <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.18)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/34">
                  {activeTab === "general" ? "Watching" : activeTab === "storage" ? "Storage" : "Sources"}
                </div>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-white">
                  {activeTab === "general"
                    ? "Make the app feel simpler"
                    : activeTab === "storage"
                      ? "Control where things are saved"
                      : "Choose where art and imports come from"}
                </h3>
                <p className="mt-2 max-w-2xl text-sm text-white/48">
                  {activeTab === "general"
                    ? "Keep only the choices that matter while watching and downloading."
                    : activeTab === "storage"
                      ? "Folder link, cache limit, and backup tools live here."
                      : "Set your preferred source and keep cover art fresh."}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryTile
                  label="Desktop link"
                  value={connectionShortText}
                  accent={localRuntimeStatus.available ? "good" : "warn"}
                />
                <SummaryTile
                  label="Library folder"
                  value={folderShortText}
                  accent={connectionReady ? "good" : "warn"}
                />
                <SummaryTile label="Save mode" value={saveModeShortText} />
              </div>
            </div>
          </div>

          {activeTab === "general" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <SectionCard title="Playback" hint="Small choices that change everyday watching.">
                <ToggleRow
                  title="Play the next episode automatically"
                  hint="Moves to the next episode when one ends."
                  checked={settings.autoplayNext}
                  onToggle={() => onSettingsChange({ autoplayNext: !settings.autoplayNext })}
                />
              </SectionCard>

              <SectionCard title="Desktop link" hint="Needed for the strongest download flow.">
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <div>
                      <div className="font-medium text-white">{connectionModeLabel}</div>
                      <div className="mt-1 text-sm text-white/42">
                        {localRuntimeStatus.available ? "Your local helper is ready." : "The app did not find a local helper."}
                      </div>
                    </div>
                    <StatusChip tone={localRuntimeStatus.available ? "good" : "warn"}>{connectionShortText}</StatusChip>
                  </div>
                  <button
                    type="button"
                    onClick={onRefreshLocalRuntime}
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/18"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Check again
                  </button>
                </div>
              </SectionCard>

              <SectionCard
                title="Save method"
                hint="Pick how full downloads should be created."
                className="xl:col-span-2"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  {downloadEngines.map((engine) => (
                    <ChoiceButton
                      key={engine.id}
                      selected={settings.downloadEngine === engine.id}
                      title={engine.label}
                      hint={engine.note}
                      onClick={() => onSettingsChange({ downloadEngine: engine.id })}
                    />
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Default source for series" hint="Used when more than one source can import a show.">
                <div className="grid gap-3">
                  {seriesOptions.map((integration) => (
                    <ChoiceButton
                      key={integration.id}
                      selected={settings.preferredSeriesSource === integration.id}
                      title={integration.name}
                      hint={integration.copy.notes}
                      onClick={() => handleSetPreferredSource("preferredSeriesSource", integration.id)}
                    />
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Default source for movies" hint="Choose the movie source you want first.">
                <div className="grid gap-3">
                  {movieOptions.map((integration) => (
                    <ChoiceButton
                      key={integration.id}
                      selected={settings.preferredMovieSource === integration.id}
                      title={integration.name}
                      hint={integration.copy.notes}
                      onClick={() => handleSetPreferredSource("preferredMovieSource", integration.id)}
                    />
                  ))}
                </div>
              </SectionCard>
            </div>
          ) : null}

          {activeTab === "storage" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <SectionCard title="Library folder" hint="Keep downloads and library data together in one place.">
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {connectionReady ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-300" />
                        )}
                        <div className="font-medium text-white">{resolvedFolderName ?? folderStateLabel}</div>
                      </div>
                      <div className="mt-1 text-sm text-white/42">{folderStateHint}</div>
                    </div>
                    <StatusChip tone={connectionReady ? "good" : "warn"}>{folderStateLabel}</StatusChip>
                  </div>

                  {isFolderConnectionSupported() ? (
                    <div className="flex flex-wrap gap-2">
                      {vaultStatus.code === "disconnected" ? (
                        <button
                          type="button"
                          onClick={handleConnectFolder}
                          disabled={folderBusy}
                          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-orange-200 disabled:opacity-60"
                        >
                          {folderBusy ? "Connecting..." : "Choose folder"}
                        </button>
                      ) : null}

                      {vaultStatus.code === "stored_handle_needs_access" ? (
                        <>
                          <button
                            type="button"
                            onClick={handleReconnectAccess}
                            disabled={folderBusy}
                            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-orange-200 disabled:opacity-60"
                          >
                            {folderBusy ? "Fixing..." : "Restore access"}
                          </button>
                          <button
                            type="button"
                            onClick={handleResetVaultLink}
                            disabled={folderBusy}
                            className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/18 disabled:opacity-60"
                          >
                            Reset link
                          </button>
                        </>
                      ) : null}

                      {(vaultStatus.code === "ready" || vaultStatus.code === "read_error" || vaultStatus.code === "write_error") ? (
                        <>
                          <button
                            type="button"
                            onClick={handleConnectFolder}
                            disabled={folderBusy}
                            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-orange-200 disabled:opacity-60"
                          >
                            Change folder
                          </button>
                          <button
                            type="button"
                            onClick={handleDisconnectFolder}
                            disabled={folderBusy}
                            className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/18 disabled:opacity-60"
                          >
                            Disconnect
                          </button>
                        </>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => void onRefreshVaultStatus()}
                        className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/18"
                      >
                        Refresh
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/45">
                      Folder linking is not available in this browser.
                    </div>
                  )}

                  <details className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/55">
                    <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-white marker:hidden">
                      <ShieldAlert className="h-4 w-4 text-white/70" />
                      Advanced details
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div>Support: <span className="text-white/80">{vaultStatus.supported ? "yes" : "no"}</span></div>
                      <div>Permission: <span className="text-white/80">{vaultStatus.permission}</span></div>
                      <div>Stored link: <span className="text-white/80">{vaultStatus.handleStored ? "yes" : "no"}</span></div>
                      <div>State: <span className="font-mono text-white/80">{vaultStatus.code}</span></div>
                    </div>
                    {(vaultDiagnostics.lastPermissionError || vaultDiagnostics.lastReadError || vaultDiagnostics.lastWriteError) ? (
                      <div className="mt-3 space-y-2 text-xs text-white/55">
                        {vaultDiagnostics.lastPermissionError ? <div>Permission: {vaultDiagnostics.lastPermissionError}</div> : null}
                        {vaultDiagnostics.lastReadError ? <div>Read: {vaultDiagnostics.lastReadError}</div> : null}
                        {vaultDiagnostics.lastWriteError ? <div>Write: {vaultDiagnostics.lastWriteError}</div> : null}
                      </div>
                    ) : null}
                  </details>
                </div>
              </SectionCard>

              <SectionCard title="Download limit" hint="How much local space the app should use before it stops caching.">
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[512, 2048, 8192].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => onSettingsChange({ offlineSizeLimitMb: size })}
                        className={clsx(
                          "rounded-2xl border px-3 py-3 text-sm font-medium transition-colors",
                          settings.offlineSizeLimitMb === size
                            ? "border-orange-400/60 bg-orange-500/10 text-white"
                            : "border-white/8 bg-black/20 text-white/70 hover:border-white/16 hover:bg-white/[0.04]",
                        )}
                      >
                        {size >= 1024 ? `${size / 1024} GB` : `${size} MB`}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={128}
                      step={128}
                      value={settings.offlineSizeLimitMb}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10);
                        if (!Number.isFinite(value)) {
                          return;
                        }
                        onSettingsChange({ offlineSizeLimitMb: Math.max(128, value) });
                      }}
                      className="w-36 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    />
                    <span className="text-sm text-white/48">MB</span>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Used now" hint="Quick view of current cache usage.">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-2xl font-semibold text-white">{usageMb} MB</div>
                      <div className="mt-1 text-sm text-white/42">
                        {offlineEpisodeCount} saved {offlineEpisodeCount === 1 ? "episode" : "episodes"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onClearOffline}
                      className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/18"
                    >
                      Clear cache
                    </button>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/50">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${usagePercent}%` }} />
                  </div>
                  <div className="text-sm text-white/42">
                    {usageMb} MB of {settings.offlineSizeLimitMb} MB used
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Backup" hint="Export your library or bring one back in.">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={onExportLibrary}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-orange-200"
                  >
                    <Download className="h-4 w-4" />
                    Export backup
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/18">
                    <Upload className="h-4 w-4" />
                    {importBusy ? "Importing..." : "Import backup"}
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
              </SectionCard>
            </div>
          ) : null}

          {activeTab === "integrations" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <SectionCard title="Cover art" hint="Choose where posters, backdrops, and logos can come from.">
                <div className="space-y-3">
                  {[
                    {
                      key: "tmdb" as const,
                      label: "TMDB",
                      note: "Best default for posters and backdrops.",
                    },
                    {
                      key: "fanart" as const,
                      label: "Fanart.tv",
                      note: "Great for logos and extra artwork.",
                    },
                    {
                      key: "tvdb" as const,
                      label: "TVDB",
                      note: "Helpful fallback when the others miss.",
                    },
                  ].map((source) => {
                    const enabled = settings.artworkSources[source.key];
                    return (
                      <ToggleRow
                        key={source.key}
                        title={source.label}
                        hint={source.note}
                        checked={enabled}
                        onToggle={() =>
                          onSettingsChange({
                            artworkSources: {
                              ...settings.artworkSources,
                              [source.key]: !enabled,
                            },
                          })
                        }
                      />
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard title="Refresh art" hint="Update covers and backdrops for titles you already imported.">
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => void onRefreshArtwork()}
                    disabled={artworkRefreshBusy}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ImageIcon className="h-4 w-4" />
                    {artworkRefreshBusy ? "Refreshing..." : "Refresh covers"}
                  </button>
                  {artworkRefreshSummary ? (
                    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/50">
                      {artworkRefreshSummary}
                    </div>
                  ) : (
                    <div className="text-sm text-white/42">Uses the sources you turned on above.</div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Import sources" hint="Modules currently available in the app." className="xl:col-span-2">
                <div className="grid gap-3 md:grid-cols-2">
                  {INTEGRATIONS.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      domain={integration.domain}
                      shortLabel={integration.copy.shortLabel}
                      note={integration.copy.notes}
                    />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/44">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-black/20 px-3 py-1.5">
                    <Tv className="h-3.5 w-3.5" />
                    Series + movies
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-black/20 px-3 py-1.5">
                    <FolderOpen className="h-3.5 w-3.5" />
                    Import ready
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-black/20 px-3 py-1.5">
                    <SettingsIcon className="h-3.5 w-3.5" />
                    Download aware
                  </span>
                </div>
              </SectionCard>

              <SectionCard
                title="Provider Feeds"
                hint="Add standalone provider pages so new episodes land directly inside Spilled."
                className="xl:col-span-2"
              >
                <div className="grid gap-3">
                  {providerFeeds.map((feed) => (
                    <div key={`${feed.moduleId}:${feed.feedId}`} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-white">{feed.title}</div>
                            <StatusChip tone={feed.enabled ? "good" : "neutral"}>{feed.providerName}</StatusChip>
                          </div>
                          <p className="mt-2 text-sm text-white/45">{feed.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleProviderFeed(feed.moduleId, feed.feedId)}
                          className={clsx(
                            "inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                            feed.enabled
                              ? "bg-white/10 text-white hover:bg-white/18"
                              : "bg-white text-black hover:bg-orange-200",
                          )}
                        >
                          {feed.enabled ? "Remove" : "Add to Spilled"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
