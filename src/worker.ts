import { type D1Database, type R2Bucket } from "@cloudflare/workers-types";
import { readExecutablePath } from "./adapter/archive.ts";
import { createD1Sql } from "./adapter/d1.ts";
import { createGitHubSource } from "./adapter/github.ts";
import { createGitHubReleaseCache, githubCacheTtlFrom } from "./adapter/github_cache.ts";
import { npmScopeFrom } from "./adapter/npm/package.ts";
import { createNpmRegistry } from "./adapter/npm/registry.ts";
import { createR2ObjectStore } from "./adapter/r2.ts";
import { createManifestStore } from "./adapter/store.ts";
import { createBuilder } from "./core/build.ts";

type Bindings = {
  TR_DB: D1Database;
  TR_ARTIFACTS: R2Bucket;
  TR_NPM_SCOPE: string;
  TR_GITHUB_TOKEN?: string;
  TR_GITHUB_CACHE_TTL?: string;
};

let app: ReturnType<typeof createNpmRegistry> | undefined;

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    try {
      if (!app) {
        // Binding I/O must run inside a request, never during module evaluation.
        const scope = npmScopeFrom(env.TR_NPM_SCOPE);
        const cacheTtl = githubCacheTtlFrom(env.TR_GITHUB_CACHE_TTL);
        const sql = createD1Sql(env.TR_DB);
        const store = await createManifestStore(sql);
        const cache = await createGitHubReleaseCache(sql);
        app = createNpmRegistry(
          scope,
          createBuilder(
            createGitHubSource({ token: env.TR_GITHUB_TOKEN, cache, cacheTtl }),
            readExecutablePath,
            store,
          ),
          createR2ObjectStore(env.TR_ARTIFACTS),
        );
      }
      return await app.fetch(request);
    } catch (error) {
      console.error("Worker initialization failed", error);
      return new Response("failed to initialize registry", { status: 502 });
    }
  },
};
