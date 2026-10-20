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

function renderPackageJson(resolved: NpmPackage): string {
  const launcher = `bin/${resolved.command}.mjs`;
  return JSON.stringify(
    {
      name: resolved.packageName,
      version: resolved.version,
      type: "module",
      bin: { [resolved.command]: launcher },
      dependencies: { "fb-dotslash": FB_DOTSLASH_VERSION },
    },
    null,
    2,
  ) + "\n";
}

function renderLauncher(command: string): string {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotslash from "fb-dotslash";

const manifest = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "manifests",
  "${command}.dotslash",
);
const child = spawn(dotslash, [manifest, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("error", () => {
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
`;
}

export async function packNpmPackage(
  resolved: NpmPackage,
): Promise<PackedNpmPackage> {
  const tar = await tarFiles([
    ["package/package.json", renderPackageJson(resolved)],
    [`package/bin/${resolved.command}.mjs`, renderLauncher(resolved.command)],
    [
      `package/manifests/${resolved.command}.dotslash`,
      renderDotslash(resolved),
    ],
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
  resolved: NpmPackage,
  packed: PackedNpmPackage,
  origin: string,
) {
  return {
    name: resolved.packageName,
    "dist-tags": { latest: packed.version },
    versions: {
      [packed.version]: versionMetadata(resolved, packed, origin),
    },
  };
}

export function versionMetadata(
  resolved: NpmPackage,
  packed: PackedNpmPackage,
  origin: string,
) {
  const unscoped = resolved.packageName.split("/")[1];
  return {
    name: resolved.packageName,
    version: packed.version,
    bin: { [resolved.command]: `bin/${resolved.command}.mjs` },
    dependencies: { "fb-dotslash": FB_DOTSLASH_VERSION },
    dist: {
      tarball:
        `${origin}/${resolved.packageName}/-/${unscoped}-${packed.version}.tgz`,
      shasum: packed.shasum,
      integrity: packed.integrity,
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
