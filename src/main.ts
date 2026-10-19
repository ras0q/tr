import { createApp } from "./app.ts";
import { fetchAsset, fetchLatestRelease } from "./github.ts";

const app = createApp(fetchLatestRelease, fetchAsset);

// `deno serve` owns the socket and requires a default export with `fetch`.
// Hono's fetch is that handler, so this module stays free of Deno.serve.
export default { fetch: app.fetch };
