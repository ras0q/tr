import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "fflate";
import { pack as createTarPack } from "tar-stream";
import { renderDotslash } from "../dotslash.ts";
import { type NpmPackage } from "./package.ts";

/** Pinned so a given release always produces the same tarball bytes. */
const FB_DOTSLASH_VERSION = "0.5.8";

export type PackedNpmPackage = {
  version: string;
  tarball: Uint8Array<ArrayBuffer>;
  shasum: string;
  integrity: string;
};

export type NpmVersionMetadata = {
  name: string;
  version: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  dist: { tarball: string; shasum: string; integrity: string };
};

function renderPackageJson(resolved: NpmPackage): string {
  return JSON.stringify(
    {
      name: resolved.packageName,
      version: resolved.version,
      bin: { [resolved.command]: `${resolved.command}.dotslash` },
      dependencies: { "fb-dotslash": FB_DOTSLASH_VERSION },
    },
    null,
    2,
  ) + "\n";
}

export async function packNpmPackage(
  resolved: NpmPackage,
): Promise<PackedNpmPackage> {
  const tar = await tarFiles([
    ["package/package.json", renderPackageJson(resolved)],
    [`package/${resolved.command}.dotslash`, renderDotslash(resolved)],
  ]);
  // Native zlib output differs by runtime. A published tarball for one version must not.
  const tarball = gzipSync(tar, { mtime: 0 });
  return {
    version: resolved.version,
    tarball,
    shasum: createHash("sha1").update(tarball).digest("hex"),
    integrity: `sha512-${
      createHash("sha512").update(tarball).digest("base64")
    }`,
  };
}

export function packument(
  metadata: NpmVersionMetadata,
  origin: string,
) {
  return {
    name: metadata.name,
    "dist-tags": { latest: metadata.version },
    versions: {
      [metadata.version]: withTarballOrigin(metadata, origin),
    },
  };
}

export function versionMetadata(
  resolved: NpmPackage,
  packed: PackedNpmPackage,
): NpmVersionMetadata {
  const unscoped = resolved.packageName.split("/")[1];
  return {
    name: resolved.packageName,
    version: packed.version,
    bin: { [resolved.command]: `${resolved.command}.dotslash` },
    dependencies: { "fb-dotslash": FB_DOTSLASH_VERSION },
    dist: {
      tarball: `/${resolved.packageName}/-/${unscoped}-${packed.version}.tgz`,
      shasum: packed.shasum,
      integrity: packed.integrity,
    },
  };
}

export function withTarballOrigin(
  metadata: NpmVersionMetadata,
  origin: string,
): NpmVersionMetadata {
  return {
    ...metadata,
    dist: {
      ...metadata.dist,
      tarball: new URL(metadata.dist.tarball, origin).href,
    },
  };
}

async function tarFiles(files: Array<[string, string]>): Promise<Buffer> {
  const archive = createTarPack();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: unknown) => {
      chunks.push(Buffer.from(chunk as Uint8Array));
    });
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  for (const [name, text] of files) {
    await new Promise<void>((resolve, reject) => {
      archive.entry(
        { name, mode: 0o644, mtime: new Date(0), uid: 0, gid: 0 },
        Buffer.from(text),
        (error) => error ? reject(error) : resolve(),
      );
    });
  }
  archive.finalize();
  return await done;
}
