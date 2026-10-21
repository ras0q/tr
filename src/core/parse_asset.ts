/**
 * Release asset names are read the way aquaproj/aqua does in pkg/asset.
 * The ranking rules live in ParseAssetName, SetOS, SetArch, Exclude, and GetOSArch.
 * A higher score wins. An archive beats a bare file. A plainer name beats a
 * variant such as `-rocm` when it is that name with a suffix removed.
 */

export type AssetInfo = {
  template: string;
  os: string;
  arch: string;
  darwinAll: boolean;
  format: string;
  replacements: Record<string, string>;
  score: number;
  musl: boolean;
};

const OS_DARWIN = "darwin";
const OS_LINUX = "linux";
const OS_WINDOWS = "windows";
const ARCH_AMD64 = "amd64";
const ARCH_ARM64 = "arm64";
const FORMAT_RAW = "raw";

const KNOWN_OS: ReadonlyArray<{ name: string; os: string }> = [
  { name: "apple-darwin", os: OS_DARWIN },
  { name: "unknown-linux-gnu", os: OS_LINUX },
  { name: "unknown-linux-musl", os: OS_LINUX },
  { name: "unknown-linux", os: OS_LINUX },
  { name: "linux-gnu", os: OS_LINUX },
  { name: "pc-windows-msvc", os: OS_WINDOWS },
  { name: "pc-windows-gnu", os: OS_WINDOWS },
  { name: "pc-windows", os: OS_WINDOWS },
  { name: OS_DARWIN, os: OS_DARWIN },
  { name: OS_LINUX, os: OS_LINUX },
  { name: OS_WINDOWS, os: OS_WINDOWS },
  { name: "apple", os: OS_DARWIN },
  { name: "macosx", os: OS_DARWIN },
  { name: "osx", os: OS_DARWIN },
  { name: "macos", os: OS_DARWIN },
  { name: "mac", os: OS_DARWIN },
  { name: "win64", os: OS_WINDOWS },
  { name: "win32", os: OS_WINDOWS },
  { name: "win", os: OS_WINDOWS },
];

const KNOWN_ARCH: ReadonlyArray<{ name: string; arch: string }> = [
  { name: ARCH_AMD64, arch: ARCH_AMD64 },
  { name: ARCH_ARM64, arch: ARCH_ARM64 },
  { name: "x86_64", arch: ARCH_AMD64 },
  { name: "x86-64", arch: ARCH_AMD64 },
  { name: "x64", arch: ARCH_AMD64 },
  { name: "64bit", arch: ARCH_AMD64 },
  { name: "64-bit", arch: ARCH_AMD64 },
  { name: "aarch64", arch: ARCH_ARM64 },
  { name: "arm", arch: ARCH_ARM64 },
];

const FORMATS = [
  "tar.br",
  "tar.bz2",
  "tar.gz",
  "tar.lz4",
  "tar.sz",
  "tar.xz",
  "tbr",
  "tbz",
  "tbz2",
  "tgz",
  "tlz4",
  "tsz",
  "txz",
  "tar.zst",
  "zip",
  "gz",
  "bz2",
  "lz4",
  "sz",
  "xz",
  "zst",
  "dmg",
  "pkg",
  "rar",
  "tar",
];

const EXCLUDE_WORDS = [
  "32-bit",
  "32bit",
  "386",
  "android",
  "armv6",
  "armv7",
  "changelog",
  "eabihf",
  "freebsd",
  "i386",
  "license",
  "mips",
  "mips64",
  "mips64le",
  "mipsle",
  "netbsd",
  "openbsd",
  "plan9",
  "ppc64",
  "ppc64le",
  "readme",
  "riscv64",
  "s390x",
  "solaris",
  "wasm",
];

const ARM32 = new Set([
  "armel",
  "armhf",
  "armle",
  "armv4",
  "armv4t",
  "armv5",
  "armv5l",
  "armv5te",
  "armv5tel",
  "armv8l",
  "arm5",
  "arm6",
  "arm7",
  "arm7l",
]);

const EXCLUDE_EXT = [
  ".deb",
  ".rpm",
  ".msi",
  ".cyclonedx.json",
  ".cyclonedx.xml",
  ".cdx.json",
  ".cdx.xml",
  ".bom.json",
  ".bom.xml",
  ".spdx.json",
  ".spdx.xml",
  ".spdx.yaml",
  ".spdx.yml",
  ".spdx.rdf",
  ".spdx",
  ".sbom.json",
  ".sbom.xml",
  ".sbom",
  ".syft.json",
];

export function parseAssetName(assetName: string, version: string): AssetInfo {
  const info: AssetInfo = {
    template: replaceOnce(assetName, version, "{{.Version}}"),
    os: "",
    arch: "",
    darwinAll: false,
    format: FORMAT_RAW,
    replacements: {},
    score: 0,
    musl: false,
  };
  if (info.template === assetName) {
    info.template = replaceOnce(
      assetName,
      version.replace(/^v/, ""),
      "{{trimV .Version}}",
    );
  }
  const low = assetName.toLowerCase();
  setOS(assetName, low, info);
  setArch(assetName, low, info);
  if (info.arch === "" && info.os === OS_DARWIN) {
    if (
      low.includes("_all") || low.includes("-all") || low.includes(".all") ||
      low.includes("_universal") || low.includes("-universal") ||
      low.includes(".universal")
    ) {
      info.darwinAll = true;
    }
  }
  // Universal macOS assets support both architectures; only other unknowns
  // fall back to amd64 with a lower preference than explicitly named assets.
  if (info.arch === "" && !info.darwinAll) {
    info.arch = ARCH_AMD64;
    info.score = -2;
  }
  if (info.os === OS_LINUX && low.includes("musl")) info.musl = true;
  info.format = formatOf(assetName);
  if (info.format !== FORMAT_RAW) {
    info.template =
      info.template.slice(0, info.template.length - info.format.length) +
      "{{.Format}}";
  }
  if (info.os === OS_WINDOWS && info.format === FORMAT_RAW) {
    if (info.template.endsWith(".exe")) {
      info.template = info.template.slice(0, -".exe".length);
    }
  }
  return info;
}

export function excludeAsset(pkgName: string, assetName: string): boolean {
  const asset = assetName.toLowerCase();
  for (const word of EXCLUDE_WORDS) {
    if (asset.includes(word) && !pkgName.includes(word)) return true;
  }
  for (const spelling of arm32Spellings(asset)) {
    if (!pkgName.includes(spelling)) return true;
  }
  return EXCLUDE_EXT.some((ext) => asset.endsWith(ext));
}

export function getOSArch(
  goos: string,
  goarch: string,
  assets: readonly AssetInfo[],
): AssetInfo | undefined {
  let archive: AssetInfo | undefined;
  let raw: AssetInfo | undefined;
  for (const asset of assets) {
    if (asset.os !== goos || (asset.arch !== goarch && !asset.darwinAll)) {
      continue;
    }
    if (asset.format === "" || asset.format === FORMAT_RAW) {
      raw = !raw || prefer(asset, raw) ? asset : raw;
      continue;
    }
    archive = !archive || prefer(asset, archive) ? asset : archive;
  }
  return archive ?? raw;
}

function prefer(candidate: AssetInfo, incumbent: AssetInfo): boolean {
  if (candidate.score !== incumbent.score) {
    return candidate.score > incumbent.score;
  }
  if (namedAfter(incumbent, candidate) || namedAfter(candidate, incumbent)) {
    return namedAfter(incumbent, candidate);
  }
  const incumbentBrace = incumbent.template.indexOf("{");
  const candidateBrace = candidate.template.indexOf("{");
  if (
    incumbentBrace !== candidateBrace && incumbentBrace !== -1 &&
    candidateBrace !== -1
  ) {
    return incumbentBrace > candidateBrace;
  }
  return plainer(candidate.template, incumbent.template);
}

function namedAfter(file: AssetInfo, of: AssetInfo): boolean {
  return file.template.startsWith(`${of.template}.`);
}

function plainer(candidate: string, incumbent: string): boolean {
  if (candidate.length >= incumbent.length) return false;
  const [candidateName, candidateFormat] = splitFormat(candidate);
  const [incumbentName, incumbentFormat] = splitFormat(incumbent);
  if (candidateFormat !== incumbentFormat) return false;
  return incumbentName.startsWith(candidateName);
}

function splitFormat(template: string): [string, string] {
  let depth = 0;
  for (let i = template.length - 1; i >= 0; i--) {
    if (template.startsWith("}}", i)) depth++;
    else if (template.startsWith("{{", i)) depth--;
    else if (template[i] === "." && depth === 0) {
      return [template.slice(0, i), template.slice(i)];
    }
  }
  return [template, ""];
}

function setOS(assetName: string, low: string, info: AssetInfo): void {
  if (low.includes(".exe.") || low.endsWith(".exe")) info.os = OS_WINDOWS;
  else if (low.endsWith(".dmg") || low.endsWith(".pkg")) {
    info.score = -1;
    info.os = OS_DARWIN;
  }
  for (const known of KNOWN_OS) {
    if (info.os !== "" && info.os !== known.os) continue;
    const idx = low.indexOf(known.name);
    if (idx === -1) continue;
    info.os = known.os;
    const spelled = assetName.slice(idx, idx + known.name.length);
    if (spelled !== known.os) info.replacements[known.os] = spelled;
    info.template = replaceOnce(info.template, spelled, "{{.OS}}");
    if (spelled === "unknown-linux-gnu" || spelled === "pc-windows-gnu") {
      info.score = -1;
    }
    return;
  }
}

function setArch(assetName: string, low: string, info: AssetInfo): void {
  for (const known of KNOWN_ARCH) {
    const idx = low.indexOf(known.name);
    if (idx === -1) continue;
    const spelled = assetName.slice(idx, idx + known.name.length);
    info.arch = known.arch;
    if (spelled !== known.arch) info.replacements[known.arch] = spelled;
    info.template = replaceOnce(info.template, spelled, "{{.Arch}}");
    if (known.arch === ARCH_ARM64 && known.name === "arm") info.score -= 1;
    break;
  }
}

function formatOf(assetName: string): string {
  for (const format of FORMATS) {
    if (assetName.endsWith(`.${format}`)) return format;
  }
  return FORMAT_RAW;
}

function arm32Spellings(asset: string): string[] {
  const words = asset.split(/[^a-z0-9]+/).filter((word) => word !== "");
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (ARM32.has(word) || word.startsWith("arm32") || word.endsWith("eabi")) {
      found.push(word);
      continue;
    }
    const next = words[i + 1];
    if (word === "arm" && (next === "v5" || next === "v6" || next === "v7")) {
      found.push(`${word}-${next}`);
    }
  }
  return found;
}

function replaceOnce(value: string, from: string, to: string): string {
  if (from === "") return value;
  const idx = value.indexOf(from);
  if (idx === -1) return value;
  return value.slice(0, idx) + to + value.slice(idx + from.length);
}
