import * as v from "valibot";
import { type ManifestStore } from "../core/build.ts";
import {
  manifestFrom,
  ResolveError,
  type ToolManifest,
} from "../core/resolve.ts";

/**
 * Statements the manifest table needs.
 * D1 implements them as `prepare(sql).bind(...params).first()` and `.run()`.
 * `first` returns `undefined` when the query has no row.
 */
export type Sql = {
  /** Executes one statement; schema statements may span multiple lines. */
  exec(sql: string): Promise<void>;
  first(
    sql: string,
    params: readonly unknown[],
  ): Promise<Record<string, unknown> | undefined>;
  run(sql: string, params: readonly unknown[]): Promise<void>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_manifest (
  source TEXT NOT NULL,
  tag TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (source, tag)
)`;

const Stored = v.object({
  source: v.string(),
  tag: v.string(),
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
    async get(source, tag) {
      const row = await sql.first(
        "SELECT body FROM tool_manifest WHERE source = ? AND tag = ?",
        [source, tag],
      );
      if (!row) return undefined;
      return parseStored(row.body);
    },
    async putIfAbsent(manifest) {
      await sql.run(
        `INSERT INTO tool_manifest (source, tag, body)
         VALUES (?, ?, ?)
         ON CONFLICT (source, tag) DO NOTHING`,
        [manifest.source, manifest.tag, JSON.stringify(manifest)],
      );
      const row = await sql.first(
        "SELECT body FROM tool_manifest WHERE source = ? AND tag = ?",
        [manifest.source, manifest.tag],
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

function parseStored(body: unknown): ToolManifest {
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
