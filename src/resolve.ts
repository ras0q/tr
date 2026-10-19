import { excludeAsset, getOSArch, parseAssetName } from "./parse_asset.ts";

/**
 * `@tr/<owner>--<repo>` uses the first `--` as the separator.
 * GitHub owner and repo names are lowercased because npm package names are.
 */

export type ReleaseAsset = {
  name: string;
  size: number;
  digest: string;
  browser_download_url: string;
};

export type Release = {
  tag_name: string;
  assets: ReleaseAsset[];
};

export type SelectedPlatform = {
  platform: string;
  os: "linux" | "darwin" | "windows";
  size: number;
  digest: string;
  /** Absent for a bare executable. tar.gz covers a `.tgz` asset. */
  format?: "tar.gz" | "zip";
  archive: "tar.gz" | "zip" | "raw";
  url: string;
  assetName: string;
};

export type SelectedRelease = {
  packageName: string;
  version: string;
  command: string;
  platforms: SelectedPlatform[];
};

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const PART = /^[a-z0-9_.-]+$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const TARGETS: ReadonlyArray<{
  os: "linux" | "darwin" | "windows";
  arch: string;
  platform: string;
}> = [
  { os: "linux", arch: "amd64", platform: "linux-x86_64" },
  { os: "linux", arch: "arm64", platform: "linux-aarch64" },
  { os: "darwin", arch: "amd64", platform: "macos-x86_64" },
  { os: "darwin", arch: "arm64", platform: "macos-aarch64" },
  { os: "windows", arch: "amd64", platform: "windows-x86_64" },
  { os: "windows", arch: "arm64", platform: "windows-aarch64" },
];

export function parsePackageName(
  name: string,
): { owner: string; repo: string } | undefined {
  if (!name.startsWith("@tr/")) return undefined;
  const body = name.slice("@tr/".length);
  const sep = body.indexOf("--");
  if (sep <= 0 || sep + 2 >= body.length) return undefined;
  const owner = body.slice(0, sep);
  const repo = body.slice(sep + 2);
  if (!PART.test(owner) || !PART.test(repo)) return undefined;
  return { owner, repo };
}

export function selectRelease(
  owner: string,
  repo: string,
  release: Release,
): SelectedRelease {
  const version = versionFromTag(release.tag_name);
  const parsed = release.assets.flatMap((asset) => {
    if (excludeAsset(repo, asset.name)) return [];
    const info = parseAssetName(asset.name, release.tag_name);
    const archive = listable(info.format);
    if (!archive) return [];
    if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      throw new ResolveError(`unexpected digest for ${asset.name}`);
    }
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new ResolveError(`unexpected size for ${asset.name}`);
    }
    const url =
      `https://github.com/${owner}/${repo}/releases/download/${release.tag_name}/${asset.name}`;
    if (asset.browser_download_url.toLowerCase() !== url.toLowerCase()) {
      throw new ResolveError(`unexpected url for ${asset.name}`);
    }
    return [{ asset, info, archive }];
  });

  const platforms: SelectedPlatform[] = [];
  const commands: string[] = [];
  for (const target of TARGETS) {
    const chosen = getOSArch(
      target.os,
      target.arch,
      parsed.map((item) => item.info),
    );
    if (!chosen) continue;
    const match = parsed.find((item) => item.info === chosen);
    if (!match) continue;
    const command = commandFromTemplate(chosen.template) || repo;
    commands.push(command);
    platforms.push({
      platform: target.platform,
      os: target.os,
      size: match.asset.size,
      digest: match.asset.digest.slice("sha256:".length),
      format: match.archive === "raw" ? undefined : match.archive,
      archive: match.archive,
      url: match.asset.browser_download_url,
      assetName: match.asset.name,
    });
  }
  if (platforms.length === 0) {
    throw new ResolveError(`no installable asset for ${owner}/${repo}`);
  }
  const command = commands[0];
  if (commands.some((item) => item !== command)) {
    throw new ResolveError(`assets disagree on the command name`);
  }
  if (!/^[A-Za-z0-9._+-]+$/.test(command)) {
    throw new ResolveError(`unsupported command name ${command}`);
  }
  return {
    packageName: `@tr/${owner}--${repo}`,
    version,
    command,
    platforms,
  };
}

function versionFromTag(tag: string): string {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  if (!SEMVER.test(version)) throw new ResolveError(`unsupported tag ${tag}`);
  return version;
}

function listable(format: string): "tar.gz" | "zip" | "raw" | undefined {
  if (format === "raw") return "raw";
  if (format === "tar.gz" || format === "tgz") return "tar.gz";
  if (format === "zip") return "zip";
  return undefined;
}

function commandFromTemplate(template: string): string {
  const head = template.split("{{")[0] ?? "";
  return head.replace(/[._-]+$/, "");
}
