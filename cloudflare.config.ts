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
      NPM_SCOPE: bindings.text("@tr"),
      DB: bindings.d1({ name: "tr-staging" }),
      ARTIFACTS: bindings.r2({ name: "tr-staging-artifacts" }),
    },
  },
});
