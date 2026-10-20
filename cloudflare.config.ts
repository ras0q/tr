import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "tr-staging",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-19",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    observability: { enabled: true },
    env: {
      TR_GITHUB_TOKEN: bindings.secret(),
      TR_GITHUB_CACHE_TTL: bindings.text("5m"),
      TR_NPM_SCOPE: bindings.text("@tr"),
      TR_DB: bindings.d1({ name: "tr-staging" }),
      TR_ARTIFACTS: bindings.r2({ name: "tr-staging-artifacts" }),
    },
  },
});
