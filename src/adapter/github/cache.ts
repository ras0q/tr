import * as v from "valibot";
import { type Sql } from "../storage/manifest.ts";

declare const githubCacheTtl: unique symbol;
/** A validated positive duration in milliseconds. */
export type GitHubCacheTtl = number & { readonly [githubCacheTtl]: never };

export function githubCacheTtlFrom(value = "5m"): GitHubCacheTtl {
  const match = /^([1-9]\d*)(s|m|h)$/.exec(value);
  if (!match) {
    throw new Error("GitHub cache TTL must be a positive duration such as 30s, 5m or 1h");
  }
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
  const milliseconds = Number(match[1]) * units[match[2]];
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error("GitHub cache TTL exceeds the supported duration");
  }
  return milliseconds as GitHubCacheTtl;
}

const Stored = v.object({
  body: v.string(),
  etag: v.nullable(v.string()),
  checkedAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  revision: v.string(),
});

type Entry = Omit<v.InferOutput<typeof Stored>, "revision">;
export type GitHubReleaseCache = Awaited<ReturnType<typeof createGitHubReleaseCache>>;

/** Mutable GitHub API snapshots, separate from immutable source manifests. */
export async function createGitHubReleaseCache(sql: Sql) {
  await sql.exec(`CREATE TABLE IF NOT EXISTS github_release_cache (
    url TEXT PRIMARY KEY NOT NULL,
    body TEXT NOT NULL,
    etag TEXT,
    checked_at INTEGER NOT NULL CHECK (checked_at >= 0),
    revision TEXT NOT NULL
  )`);

  return {
    async get(url: string) {
      const row = await sql.first(
        `SELECT body, etag, checked_at AS checkedAt, revision
         FROM github_release_cache WHERE url = ?`,
        [url],
      );
      return row ? v.parse(Stored, row) : undefined;
    },
    /** A refresh can replace only the snapshot it read, including on 304. */
    async putIfUnchanged(url: string, entry: Entry, previousRevision: string | undefined) {
      await sql.run(
        `INSERT INTO github_release_cache (url, body, etag, checked_at, revision)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET
           body = excluded.body, etag = excluded.etag,
           checked_at = excluded.checked_at, revision = excluded.revision
         WHERE github_release_cache.revision = ?`,
        [
          url,
          entry.body,
          entry.etag,
          entry.checkedAt,
          crypto.randomUUID(),
          previousRevision ?? null,
        ],
      );
    },
  };
}
