import { parseArgs } from "node:util";
import { npmScopeFrom } from "./adapter/npm/package.ts";
import { githubCacheTtlFrom } from "./adapter/github_cache.ts";

export function parseOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      "npm-scope": { type: "string" },
      "github-cache-ttl": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    npmScope: npmScopeFrom(values["npm-scope"] ?? "@tr"),
    githubCacheTtl: githubCacheTtlFrom(values["github-cache-ttl"]),
  };
}
