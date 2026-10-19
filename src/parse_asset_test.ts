import { getOSArch, parseAssetName } from "./parse_asset.ts";

Deno.test("parseAssetName matches aqua's cases", async (t) => {
  await t.assertSnapshot([
    named("basic linux tar.gz", "tool-v1.0.0-linux-amd64.tar.gz", "v1.0.0"),
    named("windows exe", "tool-1.0.0-windows-amd64.exe", "1.0.0"),
    named("darwin all", "tool-v2.1.0-darwin-all.tar.gz", "v2.1.0"),
    named("mixed case", "Tool-v1.0.0-Linux-X86_64.tar.gz", "v1.0.0"),
    named("no platform", "tool-v1.0.0.tar.gz", "v1.0.0"),
    named("gh linux", "gh_2.102.0_linux_amd64.tar.gz", "v2.102.0"),
    named("gh macos", "gh_2.102.0_macOS_arm64.zip", "v2.102.0"),
    named("gh deb ignored by format", "gh_2.102.0_linux_amd64.deb", "v2.102.0"),
  ]);
});

Deno.test("getOSArch prefers the plain archive", async (t) => {
  const names = [
    "ollama-linux-amd64-mlx.tar.zst",
    "ollama-linux-amd64-rocm.tar.zst",
    "ollama-linux-amd64.tar.zst",
    "ollama-linux-amd64.tar.gz",
  ];
  const infos = names.map((name) => parseAssetName(name, "v1.0.0"));
  const chosen = getOSArch("linux", "amd64", infos);
  await t.assertSnapshot({
    chosen: chosen?.template,
    format: chosen?.format,
  });
});

function named(label: string, assetName: string, version: string) {
  return { label, ...parseAssetName(assetName, version) };
}
