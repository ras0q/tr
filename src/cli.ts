import { parseArgs } from "node:util";
import { type NpmScope, npmScopeFrom } from "./adapter/npm/package.ts";

export function parseOptions(args: string[]): { npmScope: NpmScope } {
  const { values } = parseArgs({
    args,
    options: { "npm-scope": { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  return { npmScope: npmScopeFrom(values["npm-scope"] ?? "@tr") };
}
