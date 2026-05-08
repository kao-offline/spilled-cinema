export {};

declare global {
  interface Window {
    spilledNative?: {
      kind: "native";
      serverUrl: string;
      getStatus: () => Promise<unknown>;
      connectVault: () => Promise<{ name: string; path: string }>;
      disconnectVault: () => Promise<{ ok: boolean }>;
      getVaultStatus: () => Promise<{ kind: "ready" | "disconnected"; supported: boolean; handleStored: boolean; folderName: string | null; rootPath?: string }>;
      readVaultSnapshot: () => Promise<string | null>;
      writeVaultSnapshot: (text: string) => Promise<{ ok: boolean }>;
      listVaultArtifacts: () => Promise<{ episodeIds: string[]; files: string[]; filesByEpisodeId: Record<string, string> }>;
      writeVaultBlob: (fileName: string, bytes: Uint8Array) => Promise<{ ok: boolean; fileName: string; folderName: string }>;
      writeVaultRecord: (episodeId: string, payload: string) => Promise<{ ok: boolean }>;
      removeVaultRecord: (episodeId: string) => Promise<{ ok: boolean }>;
      clearVaultRecords: () => Promise<{ ok: boolean }>;
    };
  }
}
