import { type D1Database, type R2Bucket } from "@cloudflare/workers-types";
import { readExecutablePath } from "./adapter/archive.ts";
import { createD1Sql } from "./adapter/d1.ts";
import { fetchLatestRelease } from "./adapter/github.ts";
import { npmScopeFrom } from "./adapter/npm/package.ts";
import { createNpmRegistry } from "./adapter/npm/registry.ts";
import { createR2ObjectStore } from "./adapter/r2.ts";
import { createManifestStore } from "./adapter/store.ts";
import { createBuilder } from "./core/build.ts";

type Bindings = {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  NPM_SCOPE: string;
};

let app: ReturnType<typeof createNpmRegistry> | undefined;

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    try {
      if (!app) {
        // Binding I/O must run inside a request, never during module evaluation.
        const scope = npmScopeFrom(env.NPM_SCOPE);
        const store = await createManifestStore(createD1Sql(env.DB));
        app = createNpmRegistry(
          scope,
          createBuilder(fetchLatestRelease, readExecutablePath, store),
          createR2ObjectStore(env.ARTIFACTS),
        );
      }
      return await app.fetch(request);
    } catch (error) {
      console.error("Worker initialization failed", error);
      return new Response("failed to initialize registry", { status: 502 });
    }
  },
};
