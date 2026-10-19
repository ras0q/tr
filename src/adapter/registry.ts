import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { packResolved, packument } from "./pack.ts";
import {
  NotFoundError,
  type PackageId,
  type PackageManifest,
  parsePackageName,
  parseTarballName,
  ResolveError,
} from "../core/resolve.ts";

export function createApp(
  manifestFor: (id: PackageId) => Promise<PackageManifest>,
) {
  const app = new Hono({
    // npm encodes the scope slash (`/@tr%2fcli--cli`). Treat that as a path separator.
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
    const manifest = await manifestFor(requested.id);
    if (manifest.version !== requested.version) return c.notFound();
    const packed = await packResolved(manifest);
    return c.body(packed.tarball, 200, {
      "content-type": "application/octet-stream",
    });
  });

  app.get("/@tr/:name", async (c) => {
    const id = parsePackageName(`@tr/${c.req.param("name")}`);
    if (!id) return c.notFound();
    const manifest = await manifestFor(id);
    const packed = await packResolved(manifest);
    return c.json(packument(manifest, packed, new URL(c.req.url).origin));
  });

  return app;
}
