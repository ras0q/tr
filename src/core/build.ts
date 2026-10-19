import {
  type PackageId,
  type PackageManifest,
  type Release,
  selectRelease,
} from "./resolve.ts";

export type ReleaseSource = (owner: string, repo: string) => Promise<Release>;

export type ManifestStore = {
  get(
    packageName: string,
    version: string,
  ): Promise<PackageManifest | undefined>;
  /** The first row for a package version stays. A later write is ignored. */
  putIfAbsent(manifest: PackageManifest): Promise<PackageManifest>;
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
 * The store keeps a published version stable across restarts.
 * The map only joins builds that are already running in this process.
 */
export function createBuilder(
  latest: ReleaseSource,
  readPath: PathReader,
  store: ManifestStore,
): (id: PackageId) => Promise<PackageManifest> {
  const cache = new Map<string, Promise<PackageManifest>>();
  return async function manifestFor(id) {
    const release = await latest(id.owner, id.repo);
    const key = `@tr/${id.owner}--${id.repo}@${release.version}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = loadOrBuild(id, release, readPath, store);
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    return await pending;
  };
}

async function loadOrBuild(
  id: PackageId,
  release: Release,
  readPath: PathReader,
  store: ManifestStore,
): Promise<PackageManifest> {
  const packageName = `@tr/${id.owner}--${id.repo}`;
  const stored = await store.get(packageName, release.version);
  if (stored) return stored;
  const selected = selectRelease(id.owner, id.repo, release);
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
