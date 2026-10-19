import { createBuilder } from "./core/build.ts";
import { listArchive } from "./adapter/archive.ts";
import { fetchAsset, fetchLatestRelease } from "./adapter/github.ts";
import { createApp } from "./adapter/registry.ts";

const manifestFor = createBuilder(fetchLatestRelease, fetchAsset, listArchive);
const app = createApp(manifestFor);

// `deno serve` owns the socket and requires a default export with `fetch`.
// Hono's fetch is that handler, so this module stays free of Deno.serve.
export default { fetch: app.fetch };
