import { Hono } from "hono";
import { type Packed, packResolved, packument } from "./pack.ts";
import { parseCliRelease, type Release, ResolveError } from "./resolve.ts";

export type ReleaseSource = {
  latest(): Promise<Release>;
};

/**
 * First successful build of a version is reused for the life of the process.
 * A published npm tarball for one version must not change underneath a lockfile.
 */
export function createApp(source: ReleaseSource) {
  const cache = new Map<string, Promise<Packed>>();
  const app = new Hono();

  app.get("*", async (c) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.notFound();
    }

    if (path === "/@tr/cli--cli") {
      try {
        const packed = await current(source, cache);
        const origin = new URL(c.req.url).origin;
        return c.json(packument(packed, origin));
      } catch (error) {
        return c.text(publicMessage(error), 502);
      }
    }

    const tarball = /^\/@tr\/cli--cli\/-\/cli--cli-(\d+\.\d+\.\d+)\.tgz$/.exec(
      path,
    );
    if (tarball) {
      try {
        const packed = await current(source, cache);
        if (packed.version !== tarball[1]) return c.notFound();
        return c.body(packed.tarball, 200, {
          "content-type": "application/octet-stream",
        });
      } catch (error) {
        return c.text(publicMessage(error), 502);
      }
    }

    return c.notFound();
  });

  return app;
}

async function current(
  source: ReleaseSource,
  cache: Map<string, Promise<Packed>>,
): Promise<Packed> {
  const resolved = parseCliRelease(await source.latest());
  let pending = cache.get(resolved.version);
  if (!pending) {
    pending = packResolved(resolved);
    cache.set(resolved.version, pending);
    pending.catch(() => {
      cache.delete(resolved.version);
    });
  }
  return await pending;
}

function publicMessage(error: unknown): string {
  if (error instanceof ResolveError) return error.message;
  return "failed to build package";
}
