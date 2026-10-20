import { readExecutablePath } from "./adapter/archive.ts";
import { createNpmRegistry } from "./adapter/npm/registry.ts";
import { fetchLatestRelease } from "./adapter/github.ts";
import { createSqlite } from "./adapter/sqlite.ts";
import { createManifestStore } from "./adapter/store.ts";
import { createBuilder } from "./core/build.ts";
import { argv } from "node:process";
import { parseOptions } from "./cli.ts";

const options = parseOptions(argv.slice(2));
const store = await createManifestStore(createSqlite("tr.sqlite"));
const manifestFor = createBuilder(
  fetchLatestRelease,
  readExecutablePath,
  store,
);
const app = createNpmRegistry(options.npmScope, manifestFor);

// `deno serve` owns the socket and requires a default export with `fetch`.
// Hono's fetch is that handler, so this module stays free of Deno.serve.
export default { fetch: app.fetch };
