export const LIBRARY_ROOT_PATH = "/library";

export function buildLibraryPath() {
  return LIBRARY_ROOT_PATH;
}

export function buildLibraryShowPath(slug: string) {
  return `${LIBRARY_ROOT_PATH}/${encodeURIComponent(slug)}`;
}

export function buildLibraryWatchPath(episodeId: string) {
  return `${LIBRARY_ROOT_PATH}/watch/${encodeURIComponent(episodeId)}`;
}

export function parseLibraryPath(pathname: string):
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "show"; slug: string }
  | { kind: "watch"; episodeId: string } {
  const parts = pathname.replace(/^\/+/, "").split("/").filter(Boolean);

  if (parts.length === 0) {
    return { kind: "home" };
  }

  if (parts[0] !== "library") {
    return { kind: "home" };
  }

  if (parts[1] === "watch" && parts[2]) {
    return { kind: "watch", episodeId: decodeURIComponent(parts[2]) };
  }

  if (parts[1]) {
    return { kind: "show", slug: decodeURIComponent(parts[1]).toLowerCase() };
  }

  return { kind: "library" };
}
