import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import process from "node:process";

export default defineConfig(({ mode }) => ({
  plugins: process.env.VITEST ? [] : [cloudflare()],
  server: { host: "127.0.0.1", port: 8787 },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: { include: [mode === "e2e" ? "e2e/**/*_test.ts" : "src/**/*_test.ts"] },
}));
