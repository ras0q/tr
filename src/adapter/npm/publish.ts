import { createHash } from "node:crypto";
import * as v from "valibot";
import { type Repository, type ToolManifest } from "../../core/resolve.ts";
import { type ObjectStore } from "../../core/storage.ts";
import { createNpmPackage, type NpmScope } from "./package.ts";
import { packNpmPackage, versionMetadata } from "./pack.ts";

const Publication = v.object({
  tarballKey: v.pipe(v.string(), v.regex(/^blobs\/sha512\/[a-f0-9]{128}\.tgz$/)),
  metadata: v.object({
    name: v.string(),
    version: v.string(),
    bin: v.record(v.string(), v.string()),
    dependencies: v.optional(v.record(v.string(), v.string())),
    peerDependencies: v.optional(v.record(v.string(), v.string())),
    dist: v.object({
      tarball: v.string(),
      shasum: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/)),
      integrity: v.pipe(v.string(), v.regex(/^sha512-[A-Za-z0-9+/]{86}==$/)),
    }),
  }),
});

type PublishedNpmPackage = v.InferOutput<typeof Publication>;

/** Publication records commit a name/version only after its tarball is durable. */
export function createNpmPublisher(
  scope: NpmScope,
  manifestFor: (id: Repository) => Promise<ToolManifest>,
  objects: ObjectStore,
) {
  const encode = new TextEncoder();
  const decode = new TextDecoder();
  const keyFor = (name: string, version: string) =>
    `npm/${encodeURIComponent(name)}/${encodeURIComponent(version)}.json`;

  async function read(name: string, version: string) {
    const body = await objects.get(keyFor(name, version));
    if (body === undefined) return undefined;
    const publication = v.parse(Publication, JSON.parse(decode.decode(body)));
    if (publication.metadata.name !== name || publication.metadata.version !== version) {
      throw new Error("published package identity does not match its key");
    }
    return publication;
  }

  return {
    async resolve(id: Repository, version?: string): Promise<PublishedNpmPackage | undefined> {
      const name = `${scope}/${id.owner}--${id.repo}`;
      if (version !== undefined) {
        const stored = await read(name, version);
        if (stored) return stored;
      }
      const pkg = createNpmPackage(scope, id, await manifestFor(id));
      if (version !== undefined && version !== pkg.version) return undefined;
      const stored = await read(name, pkg.version);
      if (stored) return stored;

      const packed = await packNpmPackage(pkg);
      const digest = createHash("sha512").update(packed.tarball).digest("hex");
      const publication: PublishedNpmPackage = {
        tarballKey: `blobs/sha512/${digest}.tgz`,
        metadata: versionMetadata(pkg, packed),
      };
      await objects.putIfAbsent(publication.tarballKey, packed.tarball);
      const created = await objects.putIfAbsent(
        keyFor(name, pkg.version),
        encode.encode(JSON.stringify(publication)),
      );
      if (created) return publication;
      // A different process may have published a different generator's output.
      // Its metadata and bytes must win together, even for this request.
      const winner = await read(name, pkg.version);
      if (!winner) throw new Error("published package record is missing");
      return winner;
    },
    async tarball(publication: PublishedNpmPackage) {
      const body = await objects.get(publication.tarballKey);
      if (body === undefined) throw new Error("published tarball is missing");
      const integrity = `sha512-${createHash("sha512").update(body).digest("base64")}`;
      if (integrity !== publication.metadata.dist.integrity) {
        throw new Error("published tarball integrity does not match");
      }
      return body;
    },
  };
}
