import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ObjectStore } from "../core/storage.ts";

/** Stores opaque keys on a local filesystem with atomic hard-link creation. */
export function createFileObjectStore(directory: string): ObjectStore {
  const root = resolve(directory);
  // Hashing treats keys as data, so slashes and traversal segments cannot escape.
  const pathFor = (key: string) =>
    join(root, createHash("sha256").update(key).digest("hex"));

  return {
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if (
          error instanceof Error && "code" in error && error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
    },
    async putIfAbsent(key, body) {
      await mkdir(root, { recursive: true });
      const temporary = join(root, `.${randomUUID()}.tmp`);
      const file = await open(temporary, "wx");
      try {
        try {
          await file.writeFile(body);
          await file.sync();
        } finally {
          await file.close();
        }
        // Opening the final path with wx would expose a partially written body.
        // A hard link makes the completed file visible without replacing a winner.
        try {
          await link(temporary, pathFor(key));
        } catch (error) {
          if (
            error instanceof Error && "code" in error && error.code === "EEXIST"
          ) {
            return false;
          }
          throw error;
        }
        const parent = await open(root, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
        return true;
      } finally {
        await unlink(temporary);
      }
    },
  };
}
