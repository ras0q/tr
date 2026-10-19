import { createHash } from "node:crypto";
import {
  chooseExecutable,
  type PackageId,
  type PackageManifest,
  type Release,
  ResolveError,
  type SelectedRelease,
  selectRelease,
} from "./resolve.ts";

export type ReleaseSource = (owner: string, repo: string) => Promise<Release>;

export type AssetReader = (url: string) => Promise<Uint8Array>;

export type ArchiveLister = (
  bytes: Uint8Array,
  archive: "tar.gz" | "zip",
) => Promise<readonly string[]>;

/**
 * First successful manifest for a package version is reused for the life of the process.
 * A published npm tarball for one version must not change underneath a lockfile.
 */
export function createBuilder(
  latest: ReleaseSource,
  readAsset: AssetReader,
  listMembers: ArchiveLister,
): (id: PackageId) => Promise<PackageManifest> {
  const cache = new Map<string, Promise<PackageManifest>>();
  return async function manifestFor(id) {
    const selected = selectRelease(
      id.owner,
      id.repo,
      await latest(id.owner, id.repo),
    );
    const key = `${selected.packageName}@${selected.version}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = withPaths(selected, readAsset, listMembers);
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    return await pending;
  };
}

async function withPaths(
  selected: SelectedRelease,
  readAsset: AssetReader,
  listMembers: ArchiveLister,
): Promise<PackageManifest> {
  const platforms = [];
  for (const item of selected.platforms) {
    if (item.archive === "raw") {
      platforms.push({ ...item, path: item.assetName });
      continue;
    }
    // One archive at a time. Parallel downloads on a slow link make every
    // request miss the timeout, so the whole package fails together.
    const bytes = verifiedBytes(await readAsset(item.url), item);
    const entries = await listMembers(bytes, item.archive);
    platforms.push({
      ...item,
      path: chooseExecutable(entries, selected.command, item.os),
    });
  }
  return { ...selected, platforms };
}

function verifiedBytes(
  bytes: Uint8Array,
  asset: { assetName: string; size: number; digest: string },
): Uint8Array {
  if (bytes.byteLength !== asset.size) {
    throw new ResolveError(`unexpected size for ${asset.assetName}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.digest) {
    throw new ResolveError(`unexpected digest for ${asset.assetName}`);
  }
  return bytes;
}
