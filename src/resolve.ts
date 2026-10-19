/**
 * cli/cli release → DotSlash inputs.
 *
 * Archive paths were taken from the v2.102.0 assets, not from a general rule:
 * linux and macOS archives contain `{archive-stem}/bin/gh`; Windows zips have
 * no stem directory and store the executable at `bin/gh.exe`.
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

export type DotslashPlatform = {
  platform: string;
  size: number;
  digest: string;
  format: "tar.gz" | "zip";
  path: string;
  url: string;
};

export type ResolvedCli = {
  version: string;
  platforms: DotslashPlatform[];
};

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

const TARGETS: ReadonlyArray<{
  os: string;
  arch: string;
  platform: string;
  format: "tar.gz" | "zip";
  entry: (stem: string) => string;
}> = [
  {
    os: "linux",
    arch: "amd64",
    platform: "linux-x86_64",
    format: "tar.gz",
    entry: (stem) => `${stem}/bin/gh`,
  },
  {
    os: "linux",
    arch: "arm64",
    platform: "linux-aarch64",
    format: "tar.gz",
    entry: (stem) => `${stem}/bin/gh`,
  },
  {
    os: "macOS",
    arch: "amd64",
    platform: "macos-x86_64",
    format: "zip",
    entry: (stem) => `${stem}/bin/gh`,
  },
  {
    os: "macOS",
    arch: "arm64",
    platform: "macos-aarch64",
    format: "zip",
    entry: (stem) => `${stem}/bin/gh`,
  },
  {
    os: "windows",
    arch: "amd64",
    platform: "windows-x86_64",
    format: "zip",
    entry: () => "bin/gh.exe",
  },
  {
    os: "windows",
    arch: "arm64",
    platform: "windows-aarch64",
    format: "zip",
    entry: () => "bin/gh.exe",
  },
];

export function parseCliRelease(release: Release): ResolvedCli {
  const version = versionFromTag(release.tag_name);
  const platforms = TARGETS.map((target) => {
    const extension = target.format === "tar.gz" ? "tar.gz" : "zip";
    const name = `gh_${version}_${target.os}_${target.arch}.${extension}`;
    const asset = release.assets.find((candidate) => candidate.name === name);
    if (!asset) throw new ResolveError(`missing asset ${name}`);

    const digest = digestHex(asset.digest, name);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new ResolveError(`unexpected size for ${name}`);
    }

    const url =
      `https://github.com/cli/cli/releases/download/v${version}/${name}`;
    if (asset.browser_download_url !== url) {
      throw new ResolveError(`unexpected url for ${name}`);
    }

    const stem = name.slice(0, name.length - `.${extension}`.length);
    return {
      platform: target.platform,
      size: asset.size,
      digest,
      format: target.format,
      path: target.entry(stem),
      url,
    };
  });

  return { version, platforms };
}

function versionFromTag(tag: string): string {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new ResolveError(`unsupported tag ${tag}`);
  return match[1];
}

function digestHex(digest: string, name: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
  if (!match) throw new ResolveError(`unexpected digest for ${name}`);
  return match[1];
}
