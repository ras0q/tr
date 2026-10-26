import { type Release, type Repository, selectRelease, type ToolManifest } from "./resolve.ts";

export type ReleaseSource = (owner: string, repo: string) => Promise<Release>;

export type ManifestStore = {
  get(source: string, tag: string): Promise<ToolManifest | undefined>;
  /** The first manifest for a source and tag stays. Later writes are ignored. */
  putIfAbsent(manifest: ToolManifest): Promise<ToolManifest>;
};

export type PathAsset = {
  url: string;
  archive: "tar.gz" | "zip";
  os: "linux" | "darwin" | "windows";
  size: number;
  assetName: string;
};

/** Reads an executable path from an archive. The archive body stays unread. */
export type PathReader = (asset: PathAsset, command: string) => Promise<string>;

/**
 * The store keeps a source release stable across restarts.
 * The map only joins builds that are already running in this process.
 */
export function createBuilder(
  latest: ReleaseSource,
  readPath: PathReader,
  store: ManifestStore,
): (id: Repository) => Promise<ToolManifest> {
  const inFlight = new Map<string, Promise<ToolManifest>>();
  return async function manifestFor(id) {
    const release = await latest(id.owner, id.repo);
    const key = JSON.stringify([release.source, release.tag]);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = loadOrBuild(id, release, readPath, store).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return await pending;
  };
}

async function loadOrBuild(
  id: Repository,
  release: Release,
  readPath: PathReader,
  store: ManifestStore,
): Promise<ToolManifest> {
  const stored = await store.get(release.source, release.tag);
  if (stored) return stored;
  const selected = selectRelease(id, release);
  const platforms = [];
  for (const item of selected.platforms) {
    if (item.archive === "raw") {
      platforms.push({ ...item, path: item.assetName });
      continue;
    }
    // One archive at a time. Each read stops at the member names.
    const path = await readPath(
      {
        url: item.url,
        archive: item.archive,
        os: item.os,
        size: item.size,
        assetName: item.assetName,
      },
      selected.command,
    );
    platforms.push({ ...item, path });
  }
  return await store.putIfAbsent({ ...selected, platforms });
}
