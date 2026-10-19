import { parseCliRelease, type Release } from "./resolve.ts";

Deno.test("cli/cli release resolution", async (t) => {
  const release = realRelease();
  const missing = realRelease();
  missing.assets = missing.assets.filter((asset) =>
    !asset.name.includes("windows_arm64")
  );
  const badUrl = realRelease();
  const linux = badUrl.assets.find((asset) =>
    asset.name === "gh_2.102.0_linux_amd64.tar.gz"
  );
  if (!linux) throw new Error("fixture missing linux asset");
  linux.browser_download_url = "https://example.com/gh.tar.gz";

  await t.assertSnapshot({
    resolved: parseCliRelease(release),
    failures: {
      tag: failure(() =>
        parseCliRelease({ ...realRelease(), tag_name: "v2.102.0-rc.1" })
      ),
      missing: failure(() => parseCliRelease(missing)),
      url: failure(() => parseCliRelease(badUrl)),
    },
  });
});

function failure(run: () => unknown): string {
  try {
    run();
    return "did not throw";
  } catch (error) {
    return error instanceof Error ? error.message : "unknown error";
  }
}

function realRelease(): Release {
  const rows: Array<[string, number, string]> = [
    [
      "gh_2.102.0_linux_386.deb",
      14414892,
      "sha256:759b31942b78c05434a5d958fdacfc66aaf81446e283b4a8b1444104cf9de850",
    ],
    [
      "gh_2.102.0_linux_amd64.tar.gz",
      15319960,
      "sha256:bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386",
    ],
    [
      "gh_2.102.0_linux_arm64.tar.gz",
      13917794,
      "sha256:7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484",
    ],
    [
      "gh_2.102.0_macOS_amd64.zip",
      15995994,
      "sha256:b245f24eb2bf5f75b426b4c26da3651a107f8d5b6f4fddfbfccc5679041378b3",
    ],
    [
      "gh_2.102.0_macOS_arm64.zip",
      14359983,
      "sha256:da922c20d1792e5b2cbf375593d7a658acf034c12c84e007e71c76ef959c337e",
    ],
    [
      "gh_2.102.0_windows_amd64.zip",
      15512013,
      "sha256:ae64e556ecc240b200f7eba60d550e4bb60d78e860e69dd88c449405b86067f4",
    ],
    [
      "gh_2.102.0_windows_arm64.zip",
      13907525,
      "sha256:5dcf12aa8525eabd0c46ec414f323ab6cf65229fc2cd46543cc705001bbaf223",
    ],
  ];
  return {
    tag_name: "v2.102.0",
    assets: rows.map(([name, size, digest]) => ({
      name,
      size,
      digest,
      browser_download_url:
        `https://github.com/cli/cli/releases/download/v2.102.0/${name}`,
    })),
  };
}
