import { Buffer } from "node:buffer";
import { gunzipSync } from "fflate";
import { extract } from "tar-stream";
import { createApp } from "./app.ts";
import { type Release } from "./resolve.ts";

Deno.test("registry responses", async (t) => {
  let size = 10;
  const app = createApp({
    latest: () => Promise.resolve(release(size)),
  });
  const origin = "http://127.0.0.1:8787";

  const meta = await app.request(`${origin}/@tr%2fcli--cli`);
  const packument = await meta.json();
  const tarballUrl = packument.versions["2.102.0"].dist.tarball as string;
  const tarball = await app.request(tarballUrl);
  const files = await filesInTarball(
    new Uint8Array(await tarball.arrayBuffer()),
  );

  size = 99;
  const again = await app.request(`${origin}/@tr%2fcli--cli`);
  const againBody = await again.json();
  const missing = await app.request(`${origin}/@tr%2fother--tool`);
  const brokenApp = createApp({
    latest: () => Promise.resolve({ tag_name: "nope", assets: [] }),
  });
  const broken = await brokenApp.request(`${origin}/@tr%2fcli--cli`);

  await t.assertSnapshot({
    packument,
    tarballStatus: tarball.status,
    files,
    repeatIntegrity: againBody.versions["2.102.0"].dist.integrity,
    missingStatus: missing.status,
    broken: { status: broken.status, body: await broken.text() },
  });
});

function release(size: number): Release {
  const names = [
    ["linux", "amd64", "tar.gz"],
    ["linux", "arm64", "tar.gz"],
    ["macOS", "amd64", "zip"],
    ["macOS", "arm64", "zip"],
    ["windows", "amd64", "zip"],
    ["windows", "arm64", "zip"],
  ] as const;
  return {
    tag_name: "v2.102.0",
    assets: names.map(([os, arch, ext]) => {
      const name = `gh_2.102.0_${os}_${arch}.${ext}`;
      return {
        name,
        size,
        digest: "sha256:" + "ab".repeat(32),
        browser_download_url:
          `https://github.com/cli/cli/releases/download/v2.102.0/${name}`,
      };
    }),
  };
}

function filesInTarball(bytes: Uint8Array): Promise<Record<string, string>> {
  const archive = extract();
  const files: Record<string, string> = {};
  const done = new Promise<Record<string, string>>((resolve, reject) => {
    archive.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: unknown) => {
        chunks.push(Buffer.from(chunk as Uint8Array));
      });
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
