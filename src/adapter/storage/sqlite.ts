import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { type Sql } from "./manifest.ts";

/** Opens a SQLite file. `:memory:` is a private database for this connection. */
export function createSqlite(path: string): Sql {
  const db = new DatabaseSync(path);
  return {
    exec(sql) {
      db.exec(sql);
      return Promise.resolve();
    },
    first(sql, params) {
      const row = db.prepare(sql).get(...(params as SQLInputValue[]));
      return Promise.resolve(row === undefined ? undefined : (row as Record<string, unknown>));
    },
    run(sql, params) {
      db.prepare(sql).run(...(params as SQLInputValue[]));
      return Promise.resolve();
    },
  };
}
