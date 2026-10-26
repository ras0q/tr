import { type R2Bucket } from "@cloudflare/workers-types";
import { type ObjectStore } from "../../core/storage.ts";

export function createR2ObjectStore(bucket: R2Bucket): ObjectStore {
  return {
    async get(key) {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
    },
    async putIfAbsent(key, body) {
      // A read followed by an unconditional put would race across Workers.
      const created = await bucket.put(key, new Uint8Array(body).buffer, {
        onlyIf: { etagDoesNotMatch: "*" },
      });
      return created !== null;
    },
  };
}
