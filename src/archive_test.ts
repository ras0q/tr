import { Buffer } from "node:buffer";
import { gzipSync, zipSync } from "fflate";
import { pack as createTarPack } from "tar-stream";
import { chooseExecutable, listArchive } from "./archive.ts";

const encode = new TextEncoder();

Deno.test("chooseExecutable reads gh's two archive layouts", async (t) => {
  const linux = await tarGz({
    "gh_2.102.0_linux_amd64/LICENSE": "license",
    "gh_2.102.0_linux_amd64/bin/gh": "bin",
  });
  const windows = zipSync({
    "LICENSE": encode.encode("license"),
    "bin/gh.exe": encode.encode("bin"),
  }, { mtime: new Date("1980-01-01T00:00:00Z") });
  await t.assertSnapshot({
    linux: chooseExecutable(await listArchive(linux, "tar.gz"), "gh", "linux"),
    windows: chooseExecutable(
      await listArchive(windows, "zip"),
      "gh",
      "windows",
    ),
    goreleaser: chooseExecutable(
      ["foo_1.0.0_linux_amd64/LICENSE", "foo_1.0.0_linux_amd64/foo"],
      "foo",
      "linux",
    ),
  });
});

async function tarGz(files: Record<string, string>): Promise<Uint8Array> {
  const archive = createTarPack();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on(
      "data",
      (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)),
    );
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  for (const [name, body] of Object.entries(files)) {
    await new Promise<void>((resolve, reject) => {
      archive.entry(
        { name, mode: 0o755, mtime: new Date(0) },
        Buffer.from(body),
        (error) => error ? reject(error) : resolve(),
      );
    });
  }
  archive.finalize();
  return gzipSync(await done, { mtime: 0 });
}
