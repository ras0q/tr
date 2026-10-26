import { expect, test } from "vite-plus/test";
import { Buffer } from "node:buffer";
import { randomFillSync } from "node:crypto";
import { gzipSync, zipSync } from "fflate";
import { pack as createTarPack } from "tar-stream";
import { chooseExecutable } from "../core/resolve.ts";
import {
  executableInTarGz,
  locateZipDirectory,
  readExecutablePath,
  zipMemberNames,
} from "./archive.ts";

const encode = new TextEncoder();

test("member names come from the directory, not the file body", async () => {
  const payload = randomFillSync(new Uint8Array(256 * 1024));
  const linux = await tarGz({
    "gh_2.102.0_linux_amd64/LICENSE": encode.encode("license"),
    "gh_2.102.0_linux_amd64/bin/gh": payload,
  });
  let pulled = 0;
  const linuxPath = await executableInTarGz(
    new ReadableStream({
      pull(controller) {
        if (pulled >= linux.length) {
          controller.close();
          return;
        }
        const next = Math.min(pulled + 1024, linux.length);
        controller.enqueue(linux.subarray(pulled, next));
        pulled = next;
      },
    }),
    "gh",
    "linux",
  );
  const windowsPayload = randomFillSync(new Uint8Array(80 * 1024));
  const windows = zipSync(
    {
      LICENSE: encode.encode("license"),
      "bin/gh.exe": windowsPayload,
    },
    { mtime: new Date("1980-01-01T00:00:00Z") },
  );
  const ranges: Array<[number, number]> = [];
  const windowsPath = await readExecutablePath(
    {
      url: "https://github.com/cli/cli/releases/download/v2.102.0/gh.zip",
      archive: "zip",
      os: "windows",
      size: windows.length,
      assetName: "gh.zip",
    },
    "gh",
    (_input, init) => {
      const range = new Headers(init?.headers).get("range") ?? "";
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://assets.example/gh.zip" },
          }),
        );
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      ranges.push([start, end]);
      return Promise.resolve(
        new Response(windows.subarray(start, end + 1), {
          status: 206,
          headers: {
            "content-range": `bytes ${start}-${end}/${windows.length}`,
          },
        }),
      );
    },
  );
  const tailStart = windows.length - Math.min(windows.length, 65536 + 22);
  const tail = windows.subarray(tailStart);
  const directory = locateZipDirectory(tail);
  expect({
    linux: linuxPath,
    linuxStoppedEarly: pulled < linux.length,
    windows: windowsPath,
    windowsStartedAtTail: (ranges[0]?.[0] ?? 0) > 0,
    windowsNames: chooseExecutable(
      zipMemberNames(windows.subarray(directory.offset, directory.offset + directory.length)),
      "gh",
      "windows",
    ),
    goreleaser: chooseExecutable(
      ["foo_1.0.0_linux_amd64/LICENSE", "foo_1.0.0_linux_amd64/foo"],
      "foo",
      "linux",
    ),
  }).toMatchSnapshot();
});

async function tarGz(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
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
