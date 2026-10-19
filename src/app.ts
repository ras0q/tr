import { createHash } from "node:crypto";
import { type Context, Hono } from "hono";
import { chooseExecutable, listArchive } from "./archive.ts";
import { type Packed, packResolved, packument } from "./pack.ts";
import {
  NotFoundError,
  parsePackageName,
  type Release,
  ResolveError,
  type SelectedPlatform,
  type SelectedRelease,
  selectRelease,
} from "./resolve.ts";

export type ReleaseSource = {
  latest(owner: string, repo: string): Promise<Release>;
};

export type AssetReader = (url: string) => Promise<Uint8Array>;

type WithPath = SelectedRelease & {
  platforms: Array<SelectedPlatform & { path: string }>;
};

type Built = {
  selected: WithPath;
  packed: Packed;
};

/**
 * First successful build of a package version is reused for the life of the process.
 * A published npm tarball for one version must not change underneath a lockfile.
 */
export function createApp(source: ReleaseSource, readAsset: AssetReader) {
  const cache = new Map<string, Promise<Built>>();
  const app = new Hono();

  app.get("*", async (c) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.notFound();
    }

    const packumentMatch = /^\/@tr\/([^/]+)$/.exec(path);
    if (packumentMatch) {
      const id = parsePackageName(`@tr/${packumentMatch[1]}`);
      if (!id) return c.notFound();
      try {
        const built = await current(id, source, readAsset, cache);
        return c.json(
          packument(built.selected, built.packed, new URL(c.req.url).origin),
        );
      } catch (error) {
        return failure(c, error);
      }
    }

    const tarballMatch = /^\/@tr\/([^/]+)\/-\/(.+)\.tgz$/.exec(path);
    if (tarballMatch) {
      const id = parsePackageName(`@tr/${tarballMatch[1]}`);
      if (!id) return c.notFound();
      const unscoped = `${id.owner}--${id.repo}`;
      const prefix = `${unscoped}-`;
      if (!tarballMatch[2].startsWith(prefix)) return c.notFound();
      const version = tarballMatch[2].slice(prefix.length);
      try {
        const built = await current(id, source, readAsset, cache);
        if (built.packed.version !== version) return c.notFound();
        return c.body(built.packed.tarball, 200, {
          "content-type": "application/octet-stream",
        });
      } catch (error) {
        return failure(c, error);
      }
    }

    return c.notFound();
  });

  return app;
}

async function current(
  id: { owner: string; repo: string },
  source: ReleaseSource,
  readAsset: AssetReader,
  cache: Map<string, Promise<Built>>,
): Promise<Built> {
  const selected = selectRelease(
    id.owner,
    id.repo,
    await source.latest(id.owner, id.repo),
  );
  const key = `${selected.packageName}@${selected.version}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = materialize(selected, readAsset).then((withPaths) =>
      packResolved(withPaths).then((packed) => ({
        selected: withPaths,
        packed,
      }))
    );
    cache.set(key, pending);
    pending.catch(() => {
      cache.delete(key);
    });
  }
  return await pending;
}

async function materialize(
  selected: SelectedRelease,
  readAsset: AssetReader,
): Promise<WithPath> {
  const platforms = [];
  for (const item of selected.platforms) {
    if (item.archive === "raw") {
      platforms.push({ ...item, path: item.assetName });
      continue;
    }
    // One archive at a time. Parallel downloads on a slow link make every
    // request miss the timeout, so the whole package fails together.
    const bytes = await readAsset(item.url);
    if (bytes.byteLength !== item.size) {
      throw new ResolveError(`unexpected size for ${item.assetName}`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== item.digest) {
      throw new ResolveError(`unexpected digest for ${item.assetName}`);
    }
    const entries = await listArchive(bytes, item.archive);
    platforms.push({
      ...item,
      path: chooseExecutable(entries, selected.command, item.os),
    });
  }
  return { ...selected, platforms };
}

function failure(c: Context, error: unknown): Response {
  if (error instanceof NotFoundError) return c.text("404 Not Found", 404);
  if (error instanceof ResolveError) return c.text(error.message, 502);
  return c.text("failed to build package", 502);
}
