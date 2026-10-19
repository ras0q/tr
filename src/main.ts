import { createApp } from "./app.ts";
import { fetchAsset, fetchLatestRelease } from "./github.ts";

const app = createApp(
  { latest: fetchLatestRelease },
  fetchAsset,
);

// The host (deno serve, a Worker, Bun) binds the socket. This module only handles requests.
export default {
  fetch: app.fetch,
};
