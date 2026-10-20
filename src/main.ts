import { readExecutablePath } from "./adapter/archive.ts";
import { createNpmRegistry } from "./adapter/npm/registry.ts";
import { createGitHubSource } from "./adapter/github.ts";
import { createGitHubReleaseCache } from "./adapter/github_cache.ts";
import { createSqlite } from "./adapter/sqlite.ts";
import { createManifestStore } from "./adapter/store.ts";
import { createBuilder } from "./core/build.ts";
import { argv, env } from "node:process";
import { parseOptions } from "./cli.ts";
import { createFileObjectStore } from "./adapter/filesystem.ts";

const options = parseOptions(argv.slice(2));
const sql = createSqlite("tr.sqlite");
const store = await createManifestStore(sql);
const cache = await createGitHubReleaseCache(sql);
const manifestFor = createBuilder(
  createGitHubSource({
    token: env.TR_GITHUB_TOKEN,
    cache,
    cacheTtl: options.githubCacheTtl,
  }),
  readExecutablePath,
  store,
);
const app = createNpmRegistry(
  options.npmScope,
  manifestFor,
  createFileObjectStore("tr.objects"),
);

// `deno serve` owns the socket and requires a default export with `fetch`.
// Hono's fetch is that handler, so this module stays free of Deno.serve.
export default { fetch: app.fetch };
