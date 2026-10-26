import {
  type ExecutableReader,
  type Release,
  type Repository,
  selectRelease,
  type ToolManifest,
} from "./resolve.ts";

export type ReleaseSource = (owner: string, repo: string) => Promise<Release>;

export type ManifestStore = {
  get(source: string, tag: string): Promise<ToolManifest | undefined>;
  /** The first manifest for a source and tag stays. Later writes are ignored. */
  putIfAbsent(manifest: ToolManifest): Promise<ToolManifest>;
};

/**
 * The store keeps a source release stable across restarts.
 * The map only joins builds that are already running in this process.
 */
export function createBuilder(
  latest: ReleaseSource,
  readExecutable: ExecutableReader,
  store: ManifestStore,
): (id: Repository) => Promise<ToolManifest> {
  const inFlight = new Map<string, Promise<ToolManifest>>();
  return async function manifestFor(id) {
    const release = await latest(id.owner, id.repo);
    const key = JSON.stringify([release.source, release.tag]);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = loadOrBuild(id, release, readExecutable, store).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return await pending;
  };
}

async function loadOrBuild(
  id: Repository,
  release: Release,
  readExecutable: ExecutableReader,
  store: ManifestStore,
): Promise<ToolManifest> {
  const stored = await store.get(release.source, release.tag);
  if (stored) return stored;
  const manifest = await selectRelease(id, release, readExecutable);
  return await store.putIfAbsent(manifest);
}
