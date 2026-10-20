import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { packNpmPackage, packument } from "./pack.ts";
import {
  createNpmPackage,
  type NpmScope,
  parsePackageName,
  parseTarballName,
} from "./package.ts";
import {
  NotFoundError,
  type Repository,
  ResolveError,
  type ToolManifest,
} from "../../core/resolve.ts";

export function createNpmRegistry(
  scope: NpmScope,
  manifestFor: (id: Repository) => Promise<ToolManifest>,
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

  app.get(`/${scope}/:name/-/:file{.+\\.tgz}`, async (c) => {
    const requested = parseTarballName(
      c.req.param("name"),
      c.req.param("file"),
    );
    if (!requested) return c.notFound();
    const pkg = createNpmPackage(
      scope,
      requested.id,
      await manifestFor(requested.id),
    );
    if (pkg.version !== requested.version) return c.notFound();
    const packed = await packNpmPackage(pkg);
    return c.body(packed.tarball, 200, {
      "content-type": "application/octet-stream",
    });
  });

  app.get(`/${scope}/:name`, async (c) => {
    const id = parsePackageName(c.req.param("name"));
    if (!id) return c.notFound();
    const pkg = createNpmPackage(scope, id, await manifestFor(id));
    const packed = await packNpmPackage(pkg);
    return c.json(packument(pkg, packed, new URL(c.req.url).origin));
  });

  return app;
}
