import { type Release, selectRelease } from "./resolve.ts";

Deno.test("selectRelease picks gh archives and skips packages", async (t) => {
  const selected = selectRelease("cli", "cli", realRelease());
  await t.assertSnapshot({
    version: selected.version,
    command: selected.command,
    platforms: selected.platforms.map((item) => ({
      platform: item.platform,
      assetName: item.assetName,
      format: item.format ?? "raw",
    })),
  });
});

function realRelease(): Release {
  const rows: Array<[string, number, string]> = [
    [
      "gh_2.102.0_checksums.txt",
      1971,
      "sha256:afe49e9affa232faa8212aed035417166f6ade9b9470acb53d4dbd28c0504e8d",
    ],
    [
      "gh_2.102.0_linux_amd64.deb",
      15392446,
      "sha256:7e54a307f90afdc59796c325ec0c49fb09e6c18537727207a8ac7513584ea5b0",
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
