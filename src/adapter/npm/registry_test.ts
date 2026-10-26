import { expect, test } from "vite-plus/test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync, zipSync } from "fflate";
import { extract, pack as createTarPack } from "tar-stream";
import { createBuilder } from "../../core/build.ts";
import { chooseExecutable, releaseFrom } from "../../core/resolve.ts";
import { executableInTarGz, locateZipDirectory, zipMemberNames } from "../archive/executable.ts";
import { createSqlite } from "../storage/sqlite.ts";
import { createManifestStore } from "../storage/manifest.ts";
import { createNpmRegistry } from "./registry.ts";
import { npmScopeFrom } from "./package.ts";
import { type ObjectStore } from "../../core/storage.ts";

const encode = new TextEncoder();
const origin = "http://127.0.0.1:8787";
const fixtureBytes = new Map<string, Uint8Array>();

test("registry responses", async () => {
  const body = await ghBody();
  let tamper = false;
  const store = await createManifestStore(createSqlite(":memory:"));
  const data = new Map<string, Uint8Array<ArrayBuffer>>();
  const objects: ObjectStore = {
    get: (key) => Promise.resolve(data.get(key)?.slice()),
    putIfAbsent(key, body) {
      if (data.has(key)) return Promise.resolve(false);
      data.set(key, new Uint8Array(body));
      return Promise.resolve(true);
    },
  };
  const app = createNpmRegistry(
    npmScopeFrom("@tr"),
    createBuilder(
      () => {
        const release = structuredClone(body);
        if (tamper) release.assets[0].size = 99;
        return Promise.resolve(
          releaseFrom({
            source: "https://github.com/cli/cli",
            tag: release.tag_name,
            assets: release.assets.map((asset) => ({
              name: asset.name,
              size: asset.size,
              digest: asset.digest.slice("sha256:".length),
              url: asset.browser_download_url,
            })),
          }),
        );
      },
      readFixturePath,
      store,
    ),
    objects,
  );

  const meta = await app.request(`${origin}/@tr%2fcli--cli`);
  const packument = await meta.json();
  const tarballUrl = packument.versions["2.102.0"].dist.tarball as string;
  const tarball = await app.request(tarballUrl);
  const files = await filesInTarball(new Uint8Array(await tarball.arrayBuffer()));

  tamper = true;
  const again = await app.request(`${origin}/@tr%2fcli--cli`);
  const againBody = await again.json();
  const missing = await app.request(`${origin}/not-a-package`);
  const brokenApp = createNpmRegistry(
    npmScopeFrom("@tr"),
    createBuilder(
      () =>
        Promise.resolve(
          releaseFrom({
            source: "https://github.com/cli/cli",
            tag: "v1.0.0",
            assets: [],
          }),
        ),
      () => Promise.reject(new Error("unread")),
      await createManifestStore(createSqlite(":memory:")),
    ),
    objects,
  );
  const broken = await brokenApp.request(`${origin}/@tr%2fcli--cli`);

  expect({
    packument,
    tarballStatus: tarball.status,
    files,
    repeatIntegrity: againBody.versions["2.102.0"].dist.integrity,
    missingStatus: missing.status,
    broken: { status: broken.status, body: await broken.text() },
  }).toMatchSnapshot();
});

async function readFixturePath(
  asset: { url: string; archive: "tar.gz" | "zip"; os: string },
  command: string,
): Promise<string> {
  const bytes = fixtureBytes.get(asset.url);
  if (!bytes) throw new Error(asset.url);
  if (asset.archive === "zip") {
    const directory = locateZipDirectory(bytes);
    return chooseExecutable(
      zipMemberNames(bytes.subarray(directory.offset, directory.offset + directory.length)),
      command,
      asset.os,
    );
  }
  return await executableInTarGz(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    command,
    asset.os,
  );
}

async function ghBody() {
  const specs = [
    ["linux", "amd64", "tar.gz"],
    ["linux", "arm64", "tar.gz"],
    ["macOS", "amd64", "zip"],
    ["macOS", "arm64", "zip"],
    ["windows", "amd64", "zip"],
    ["windows", "arm64", "zip"],
  ] as const;
  const assets = [];
  for (const [os, arch, ext] of specs) {
    const name = `gh_2.102.0_${os}_${arch}.${ext}`;
    const url = `https://github.com/cli/cli/releases/download/v2.102.0/${name}`;
    const bytes =
      ext === "tar.gz"
        ? await tarGz({ [`gh_2.102.0_${os}_${arch}/bin/gh`]: "bin" })
        : zipSync(
            {
              LICENSE: encode.encode("license"),
              [os === "windows" ? "bin/gh.exe" : `gh_2.102.0_${os}_${arch}/bin/gh`]:
                encode.encode("bin"),
            },
            { mtime: new Date("1980-01-01T00:00:00Z") },
          );
    fixtureBytes.set(url, bytes);
    assets.push({
      name,
      size: bytes.byteLength,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      browser_download_url: url,
    });
  }
  return { tag_name: "v2.102.0", assets };
}

async function tarGz(files: Record<string, string>): Promise<Uint8Array> {
  const archive = createTarPack();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  for (const [name, body] of Object.entries(files)) {
    await new Promise<void>((resolve, reject) => {
      archive.entry({ name, mode: 0o755, mtime: new Date(0) }, Buffer.from(body), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }
  archive.finalize();
  return gzipSync(await done, { mtime: 0 });
}

function filesInTarball(bytes: Uint8Array): Promise<Record<string, string>> {
  const archive = extract();
  const files: Record<string, string> = {};
  const done = new Promise<Record<string, string>>((resolve, reject) => {
    archive.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
      stream.on("end", () => {
        files[header.name] = Buffer.concat(chunks).toString("utf8");
        next();
      });
      stream.on("error", reject);
    });
    archive.on("finish", () => resolve(files));
    archive.on("error", reject);
  });
  archive.end(gunzipSync(bytes));
  return done;
}
