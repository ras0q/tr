import * as v from "valibot";
import { type ManifestStore } from "../core/build.ts";
import {
  manifestFrom,
  type PackageManifest,
  ResolveError,
} from "../core/resolve.ts";

/**
 * Statements the manifest table needs.
 * D1 implements them as `prepare(sql).bind(...params).first()` and `.run()`.
 * `first` returns `undefined` when the query has no row.
 */
export type Sql = {
  exec(sql: string): Promise<void>;
  first(
    sql: string,
    params: readonly unknown[],
  ): Promise<Record<string, unknown> | undefined>;
  run(sql: string, params: readonly unknown[]): Promise<void>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS manifest (
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (package_name, version)
)`;

const Stored = v.object({
  packageName: v.string(),
  version: v.string(),
  command: v.string(),
  platforms: v.array(v.object({
    platform: v.string(),
    os: v.picklist(["linux", "darwin", "windows"]),
    size: v.number(),
    digest: v.string(),
    archive: v.picklist(["raw", "tar.gz", "zip"]),
    url: v.string(),
    assetName: v.string(),
    path: v.string(),
  })),
});

export async function createManifestStore(sql: Sql): Promise<ManifestStore> {
  await sql.exec(SCHEMA);
  return {
    async get(packageName, version) {
      const row = await sql.first(
        "SELECT body FROM manifest WHERE package_name = ? AND version = ?",
        [packageName, version],
      );
      if (!row) return undefined;
      return parseStored(row.body);
    },
    async putIfAbsent(manifest) {
      await sql.run(
        `INSERT INTO manifest (package_name, version, body)
         VALUES (?, ?, ?)
         ON CONFLICT (package_name, version) DO NOTHING`,
        [manifest.packageName, manifest.version, JSON.stringify(manifest)],
      );
      const row = await sql.first(
        "SELECT body FROM manifest WHERE package_name = ? AND version = ?",
        [manifest.packageName, manifest.version],
      );
      if (!row) {
        throw new ResolveError(
          "stored manifest did not match the expected shape",
        );
      }
      return parseStored(row.body);
    },
  };
}

function parseStored(body: unknown): PackageManifest {
  let json: unknown;
  try {
    json = JSON.parse(String(body));
  } catch {
    throw new ResolveError("stored manifest did not match the expected shape");
  }
  const parsed = v.safeParse(Stored, json);
  if (!parsed.success) {
    throw new ResolveError("stored manifest did not match the expected shape");
  }
  return manifestFrom(parsed.output);
}
