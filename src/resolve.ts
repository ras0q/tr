import * as v from "valibot";
import { excludeAsset, getOSArch, parseAssetName } from "./parse_asset.ts";

/**
 * `@tr/<owner>--<repo>` uses the first `--` as the separator.
 * GitHub owner and repo names are lowercased because npm package names are.
 *
 * Untrusted JSON is parsed once into these types. Later steps use the result
 * and do not re-read the original strings.
 */

declare const semver: unique symbol;
declare const sha256: unique symbol;
declare const byteSize: unique symbol;

export type Semver = string & { readonly [semver]: never };
export type Sha256 = string & { readonly [sha256]: never };
export type ByteSize = number & { readonly [byteSize]: never };

export type PackageId = { owner: string; repo: string };

export type ReleaseAsset = {
  name: string;
  size: ByteSize;
  digest: Sha256;
  url: string;
};

export type Release = {
  tag: string;
  version: Semver;
  assets: ReleaseAsset[];
};

type PlatformBase = {
  platform: string;
  os: "linux" | "darwin" | "windows";
  size: ByteSize;
  digest: Sha256;
  url: string;
  assetName: string;
};

export type SelectedPlatform =
  & PlatformBase
  & (
    | { archive: "raw" }
    | { archive: "tar.gz" | "zip" }
  );

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

const ReleaseShape = v.object({
  tag_name: v.string(),
  assets: v.array(v.object({
    name: v.string(),
    size: v.number(),
    digest: v.string(),
    browser_download_url: v.string(),
  })),
});

export function parsePackageName(name: string): PackageId | undefined {
  if (!name.startsWith("@tr/")) return undefined;
  const body = name.slice("@tr/".length);
  const sep = body.indexOf("--");
  if (sep <= 0 || sep + 2 >= body.length) return undefined;
  const owner = body.slice(0, sep);
  const repo = body.slice(sep + 2);
  if (!PART.test(owner) || !PART.test(repo)) return undefined;
  return { owner, repo };
}

/** `cli--cli-2.102.0.tgz` → the package and the version the client asked for. */
export function parseTarballName(
  name: string,
  file: string,
): { id: PackageId; version: Semver } | undefined {
  const id = parsePackageName(`@tr/${name}`);
  if (!id) return undefined;
  const unscoped = `${id.owner}--${id.repo}`;
  const prefix = `${unscoped}-`;
  if (!file.startsWith(prefix) || !file.endsWith(".tgz")) return undefined;
  const version = file.slice(prefix.length, -".tgz".length);
  if (!SEMVER.test(version)) return undefined;
  return { id, version: version as Semver };
}

export function parseRelease(
  owner: string,
  repo: string,
  input: unknown,
): Release {
  const parsed = v.safeParse(ReleaseShape, input);
  if (!parsed.success) {
    throw new ResolveError("GitHub release did not match the expected shape");
  }
  const { tag_name: tag, assets } = parsed.output;
  return {
    tag,
    version: parseVersion(tag),
    assets: assets.map((asset) => parseReleaseAsset(owner, repo, tag, asset)),
  };
}

export function selectRelease(
  owner: string,
  repo: string,
  release: Release,
): SelectedRelease {
  const parsed = release.assets.flatMap((asset) => {
    if (excludeAsset(repo, asset.name)) return [];
    const info = parseAssetName(asset.name, release.tag);
    const archive = listable(info.format);
    if (!archive) return [];
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
    commands.push(parseCommand(chosen.template, repo));
    platforms.push({
      platform: target.platform,
      os: target.os,
      size: match.asset.size,
      digest: match.asset.digest,
      archive: match.archive,
      url: match.asset.url,
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
  return {
    packageName: `@tr/${owner}--${repo}`,
    version: release.version,
    command,
    platforms,
  };
}

function parseVersion(tag: string): Semver {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  if (!SEMVER.test(version)) throw new ResolveError(`unsupported tag ${tag}`);
  return version as Semver;
}

function parseReleaseAsset(
  owner: string,
  repo: string,
  tag: string,
  asset: {
    name: string;
    size: number;
    digest: string;
    browser_download_url: string;
  },
): ReleaseAsset {
  const digest = /^sha256:([a-f0-9]{64})$/.exec(asset.digest);
  if (!digest) throw new ResolveError(`unexpected digest for ${asset.name}`);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new ResolveError(`unexpected size for ${asset.name}`);
  }
  const url =
    `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset.name}`;
  if (asset.browser_download_url.toLowerCase() !== url.toLowerCase()) {
    throw new ResolveError(`unexpected url for ${asset.name}`);
  }
  return {
    name: asset.name,
    size: asset.size as ByteSize,
    digest: digest[1] as Sha256,
    url,
  };
}

function parseCommand(template: string, repo: string): string {
  const command = (template.split("{{")[0] ?? "").replace(/[._-]+$/, "") ||
    repo;
  if (!/^[A-Za-z0-9._+-]+$/.test(command)) {
    throw new ResolveError(`unsupported command name ${command}`);
  }
  return command;
}

function listable(format: string): "tar.gz" | "zip" | "raw" | undefined {
  if (format === "raw") return "raw";
  if (format === "tar.gz" || format === "tgz") return "tar.gz";
  if (format === "zip") return "zip";
  return undefined;
}
