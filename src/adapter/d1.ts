import { type D1Database } from "@cloudflare/workers-types";
import { type Sql } from "./store.ts";

export function createD1Sql(database: D1Database): Sql {
  return {
    async exec(sql) {
      // D1.exec splits on newlines; prepare preserves a multiline statement.
      await database.prepare(sql).run();
    },
    async first(sql, params) {
      return await database.prepare(sql).bind(...params)
        .first<Record<string, unknown>>() ?? undefined;
    },
    async run(sql, params) {
      await database.prepare(sql).bind(...params).run();
    },
  };
}
