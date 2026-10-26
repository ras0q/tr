import { expect, test } from "vite-plus/test";
import { getOSArch, parseAssetName } from "./parse_asset.ts";

test("parseAssetName matches aqua's cases", async () => {
  const cases = [
    ["basic linux tar.gz", "tool-v1.0.0-linux-amd64.tar.gz", "v1.0.0"],
    ["windows exe", "tool-1.0.0-windows-amd64.exe", "1.0.0"],
    ["darwin all", "tool-v2.1.0-darwin-all.tar.gz", "v2.1.0"],
    ["mixed case", "Tool-v1.0.0-Linux-X86_64.tar.gz", "v1.0.0"],
    ["no platform", "tool-v1.0.0.tar.gz", "v1.0.0"],
    ["gh linux", "gh_2.102.0_linux_amd64.tar.gz", "v2.102.0"],
    ["gh macos", "gh_2.102.0_macOS_arm64.zip", "v2.102.0"],
    ["gh deb ignored by format", "gh_2.102.0_linux_amd64.deb", "v2.102.0"],
  ] as const;
  expect(
    cases.map(([label, assetName, version]) => ({
      label,
      ...parseAssetName(assetName, version),
    })),
  ).toMatchSnapshot();
});

test("getOSArch prefers the plain archive", async () => {
  const chosen = getOSArch(
    "linux",
    "amd64",
    [
      "ollama-linux-amd64-mlx.tar.zst",
      "ollama-linux-amd64-rocm.tar.zst",
      "ollama-linux-amd64.tar.zst",
      "ollama-linux-amd64.tar.gz",
    ].map((name) => ({ ...parseAssetName(name, "v1.0.0"), architectures: ["amd64"] })),
  );
  expect({ chosen: chosen?.template, format: chosen?.format }).toMatchSnapshot();
});
