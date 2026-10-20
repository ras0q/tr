/** Opaque keys identify immutable objects with read-after-write consistency. */
export type ObjectStore = {
  /** Returns a complete body, or undefined only when the key is absent. */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  /** Atomically creates a complete object. False means the key already exists. */
  putIfAbsent(key: string, body: Uint8Array): Promise<boolean>;
};
