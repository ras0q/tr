import { expect, test } from "vite-plus/test";
import { manifestFrom } from "../../core/resolve.ts";
import { createSqlite } from "./sqlite.ts";
import { createManifestStore } from "./manifest.ts";

test("the first manifest for a version is the one that stays", async () => {
  const store = await createManifestStore(createSqlite(":memory:"));
  const first = manifest("gh_2.102.0_linux_amd64/bin/gh");
  const saved = await store.putIfAbsent(first);
  const raced = await store.putIfAbsent(manifest("wrong"));
  const loaded = await store.get(first.source, first.tag);
  expect({
    saved: saved.platforms[0].path,
    raced: raced.platforms[0].path,
    loaded: loaded?.platforms[0].path,
  }).toMatchSnapshot();
});

function manifest(path: string) {
  return manifestFrom({
    source: "https://github.com/cli/cli",
    tag: "v2.102.0",
    command: "gh",
    platforms: [
      {
        platform: "linux-x86_64",
        os: "linux",
        size: 15319960,
        digest: "ab".repeat(32),
        archive: "tar.gz",
        url: "https://github.com/cli/cli/releases/download/v2.102.0/gh.tar.gz",
        assetName: "gh.tar.gz",
        path,
      },
    ],
  });
}
