import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { packument, withTarballOrigin } from "./pack.ts";
import { type NpmScope, parsePackageName, parseTarballName } from "./package.ts";
import {
  NotFoundError,
  type Repository,
  ResolveError,
  type ToolManifest,
} from "../../core/resolve.ts";
import { type ObjectStore } from "../../core/storage.ts";
import { createNpmPublisher } from "./publish.ts";

export function createNpmRegistry(
  scope: NpmScope,
  manifestFor: (id: Repository) => Promise<ToolManifest>,
  objects: ObjectStore,
) {
  const packages = createNpmPublisher(scope, manifestFor, objects);
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

  app.get("/", (c) => {
    const origin = new URL(c.req.url).origin;
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>tr: Your CLI tools, managed with npm</title>
  </head>
  <body>
    <main>
      <h1>tr</h1>
      <p>Your CLI tools, managed with npm.</p>
      <p>Install CLI tools from GitHub Releases and manage them in your project's package.json and lockfile.</p>
      <p>Configure this registry in your <code>.npmrc</code>:</p>
      <pre><code>${scope}:registry=${origin}</code></pre>
      <p>Packages use the name <code>${scope}/&lt;owner&gt;--&lt;repo&gt;</code>. For example, <code>${scope}/cli--cli</code> provides GitHub CLI (<code>gh</code>).</p>
      <p><a href="https://github.com/ras0q/tr">Learn more about tr</a></p>
    </main>
  </body>
</html>
`;
    return c.body(html, 200, { "content-type": "text/html; charset=utf-8" });
  });

  app.notFound((c) => c.text("404 Not Found", 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof NotFoundError) return c.text("404 Not Found", 404);
    console.error({
      event: "registry_error",
      name: err.name,
      message: err.message,
    });
    if (err instanceof ResolveError) return c.text(err.message, 502);
    return c.text("failed to build package", 502);
  });

  app.get(`/${scope}/:name/-/:file{.+\\.tgz}`, async (c) => {
    const requested = parseTarballName(c.req.param("name"), c.req.param("file"));
    if (!requested) return c.notFound();
    const published = await packages.resolve(requested.id, requested.version);
    if (!published) return c.notFound();
    return c.body(await packages.tarball(published), 200, {
      "content-type": "application/octet-stream",
    });
  });

  app.get(`/${scope}/:name/:version`, async (c) => {
    const id = parsePackageName(c.req.param("name"));
    if (!id) return c.notFound();
    const version = c.req.param("version");
    const published = await packages.resolve(id, version === "latest" ? undefined : version);
    if (!published) return c.notFound();
    return c.json(withTarballOrigin(published.metadata, new URL(c.req.url).origin));
  });

  app.get(`/${scope}/:name`, async (c) => {
    const id = parsePackageName(c.req.param("name"));
    if (!id) return c.notFound();
    const published = await packages.resolve(id);
    if (!published) return c.notFound();
    return c.json(packument(published.metadata, new URL(c.req.url).origin));
  });

  return app;
}
