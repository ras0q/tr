import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { chooseExecutable, listArchive } from "./archive.ts";
import {
  type Packed,
  type PackedRelease,
  packResolved,
  packument,
} from "./pack.ts";
import {
  NotFoundError,
  parsePackageName,
  parseTarballName,
  type Release,
  ResolveError,
  type SelectedRelease,
  selectRelease,
} from "./resolve.ts";

type Built = { selected: PackedRelease; packed: Packed };

/**
 * First successful build of a package version is reused for the life of the process.
 * A published npm tarball for one version must not change underneath a lockfile.
 */
export function createApp(
  latest: (owner: string, repo: string) => Promise<Release>,
  readAsset: (url: string) => Promise<Uint8Array>,
) {
  const cache = new Map<string, Promise<Built>>();
  // npm encodes the scope slash (`/@tr%2fcli--cli`). Treat that as a path separator.
  const app = new Hono({
    getPath: (req) => {
      try {
        return decodeURIComponent(new URL(req.url).pathname);
      } catch {
        return "/";
      }
    },
  });

  app.notFound((c) => c.text("404 Not Found", 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof NotFoundError) return c.text("404 Not Found", 404);
    if (err instanceof ResolveError) return c.text(err.message, 502);
    return c.text("failed to build package", 502);
  });

  app.get("/@tr/:name/-/:file{.+\\.tgz}", async (c) => {
    const requested = parseTarballName(
      c.req.param("name"),
      c.req.param("file"),
    );
    if (!requested) return c.notFound();
    const built = await current(requested.id, latest, readAsset, cache);
    if (built.packed.version !== requested.version) return c.notFound();
    return c.body(built.packed.tarball, 200, {
      "content-type": "application/octet-stream",
    });
  });

  app.get("/@tr/:name", async (c) => {
    const id = parsePackageName(`@tr/${c.req.param("name")}`);
    if (!id) return c.notFound();
    const built = await current(id, latest, readAsset, cache);
    return c.json(
      packument(built.selected, built.packed, new URL(c.req.url).origin),
    );
  });

  return app;
}

async function current(
  id: { owner: string; repo: string },
  latest: (owner: string, repo: string) => Promise<Release>,
  readAsset: (url: string) => Promise<Uint8Array>,
  cache: Map<string, Promise<Built>>,
): Promise<Built> {
  const selected = selectRelease(
    id.owner,
    id.repo,
    await latest(id.owner, id.repo),
  );
  const key = `${selected.packageName}@${selected.version}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = materialize(selected, readAsset).then(async (withPaths) => ({
      selected: withPaths,
      packed: await packResolved(withPaths),
    }));
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return await pending;
}

async function materialize(
  selected: SelectedRelease,
  readAsset: (url: string) => Promise<Uint8Array>,
): Promise<PackedRelease> {
  const platforms = [];
  for (const item of selected.platforms) {
    if (item.archive === "raw") {
      platforms.push({ ...item, path: item.assetName });
      continue;
    }
    // One archive at a time. Parallel downloads on a slow link make every
    // request miss the timeout, so the whole package fails together.
    const bytes = verifiedBytes(await readAsset(item.url), item);
    const entries = await listArchive(bytes, item.archive);
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
