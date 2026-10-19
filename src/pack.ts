import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "fflate";
import { pack as createTarPack } from "tar-stream";
import { type ResolvedCli } from "./resolve.ts";

/** Pinned so a given cli release always produces the same tarball bytes. */
export const FB_DOTSLASH_VERSION = "0.5.8";

export const PACKAGE_NAME = "@tr/cli--cli";

const LAUNCHER_PATH = "bin/gh.mjs";

export type Packed = {
  version: string;
  tarball: Uint8Array<ArrayBuffer>;
  shasum: string;
  integrity: string;
};

export function renderDotslash(resolved: ResolvedCli): string {
  const platforms: Record<string, unknown> = {};
  const ordered = [...resolved.platforms].sort((a, b) =>
    a.platform.localeCompare(b.platform)
  );
  for (const item of ordered) {
    platforms[item.platform] = {
      size: item.size,
      hash: "sha256",
      digest: item.digest,
      format: item.format,
      path: item.path,
      providers: [{ url: item.url }],
    };
  }
  const body = JSON.stringify({ name: "gh", platforms }, null, 2);
  return `#!/usr/bin/env dotslash\n${body}\n`;
}

export function renderPackageJson(version: string): string {
  return JSON.stringify(
    {
      name: PACKAGE_NAME,
      version,
      type: "module",
      bin: { gh: LAUNCHER_PATH },
      dependencies: { "fb-dotslash": FB_DOTSLASH_VERSION },
    },
    null,
    2,
  ) + "\n";
}

export function renderLauncher(): string {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotslash from "fb-dotslash";

const manifest = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "manifests",
  "gh.dotslash",
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

export async function packResolved(resolved: ResolvedCli): Promise<Packed> {
  const tar = await tarFiles([
    ["package/package.json", renderPackageJson(resolved.version)],
    [`package/${LAUNCHER_PATH}`, renderLauncher()],
    ["package/manifests/gh.dotslash", renderDotslash(resolved)],
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

export function packument(packed: Packed, origin: string) {
  return {
    name: PACKAGE_NAME,
    "dist-tags": { latest: packed.version },
    versions: {
      [packed.version]: {
        name: PACKAGE_NAME,
        version: packed.version,
        bin: { gh: LAUNCHER_PATH },
        dependencies: { "fb-dotslash": FB_DOTSLASH_VERSION },
        dist: {
          tarball: `${origin}/@tr/cli--cli/-/cli--cli-${packed.version}.tgz`,
          shasum: packed.shasum,
          integrity: packed.integrity,
        },
      },
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

  const write = async () => {
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
  };

  await write();
  return await done;
}
