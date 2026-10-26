import { excludeAsset, getOSArch, parseAssetName } from "./parse_asset.ts";

declare const sha256: unique symbol;
declare const byteSize: unique symbol;

export type Sha256 = string & { readonly [sha256]: never };
export type ByteSize = number & { readonly [byteSize]: never };

export type Repository = { owner: string; repo: string };

export type ReleaseAsset = {
  name: string;
  size: ByteSize;
  digest: Sha256;
  url: string;
};

export type Release = {
  source: string;
  tag: string;
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

export type SelectedPlatform = PlatformBase & ({ archive: "raw" } | { archive: "tar.gz" | "zip" });

export type SelectedRelease = {
  source: string;
  tag: string;
  command: string;
  platforms: SelectedPlatform[];
};

export type ToolManifest = SelectedRelease & {
  platforms: Array<SelectedPlatform & { path: string }>;
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

export function manifestFrom(input: {
  source: string;
  tag: string;
  command: string;
  platforms: readonly {
    platform: string;
    os: "linux" | "darwin" | "windows";
    size: number;
    digest: string;
    archive: "raw" | "tar.gz" | "zip";
    url: string;
    assetName: string;
    path: string;
  }[];
}): ToolManifest {
  validateSource(input.source, input.tag);
  if (!/^[A-Za-z0-9._+-]+$/.test(input.command)) {
    throw new ResolveError(`unsupported command name ${input.command}`);
  }
  if (input.platforms.length === 0) {
    throw new ResolveError("stored manifest did not match the expected shape");
  }
  return {
    source: input.source,
    tag: input.tag,
    command: input.command,
    platforms: input.platforms.map((item) => {
      if (!/^[a-f0-9]{64}$/.test(item.digest)) {
        throw new ResolveError(`unexpected digest for ${item.assetName}`);
      }
      if (!Number.isSafeInteger(item.size) || item.size <= 0) {
        throw new ResolveError(`unexpected size for ${item.assetName}`);
      }
      const path = item.path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (path === "" || path.split("/").includes("..")) {
        throw new ResolveError(`unexpected path for ${item.assetName}`);
      }
      const base = {
        platform: item.platform,
        os: item.os,
        size: item.size as ByteSize,
        digest: item.digest as Sha256,
        url: item.url,
        assetName: item.assetName,
        path,
      };
      if (item.archive === "raw") return { ...base, archive: "raw" as const };
      return { ...base, archive: item.archive };
    }),
  };
}

export function releaseFrom(input: {
  source: string;
  tag: string;
  assets: readonly {
    name: string;
    size: number;
    digest: string;
    url: string;
  }[];
}): Release {
  validateSource(input.source, input.tag);
  return {
    source: input.source,
    tag: input.tag,
    assets: input.assets.map((asset) => {
      if (!/^[a-f0-9]{64}$/.test(asset.digest)) {
        throw new ResolveError(`unexpected digest for ${asset.name}`);
      }
      if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
        throw new ResolveError(`unexpected size for ${asset.name}`);
      }
      return {
        name: asset.name,
        size: asset.size as ByteSize,
        digest: asset.digest as Sha256,
        url: asset.url,
      };
    }),
  };
}

export function selectRelease({ owner, repo }: Repository, release: Release): SelectedRelease {
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
    source: release.source,
    tag: release.tag,
    command,
    platforms,
  };
}

function validateSource(source: string, tag: string): void {
  if (!URL.canParse(source) || tag === "") {
    throw new ResolveError("release must have a source URL and a tag");
  }
}

function parseCommand(template: string, repo: string): string {
  const command = (template.split("{{")[0] ?? "").replace(/[._-]+$/, "") || repo;
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

/** The Windows zip has no top-level directory, so the path comes from the member list. */
export function chooseExecutable(paths: readonly string[], command: string, os: string): string {
  const files = paths.map(normalizePath).filter((path) => path !== "");
  const want = new Set(
    os === "windows"
      ? [command.toLowerCase(), `${command.toLowerCase()}.exe`]
      : [command.toLowerCase()],
  );
  const matches = files.filter((path) =>
    want.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase()),
  );
  const exe = matches.filter((path) => path.toLowerCase().endsWith(".exe"));
  const pool = os === "windows" && exe.length > 0 ? exe : matches;
  const binned = pool.filter((path) => path.split("/").includes("bin"));
  const ranked = (binned.length > 0 ? binned : pool).toSorted(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  if (ranked.length === 0) {
    throw new ResolveError(`no executable named ${command}`);
  }
  if (ranked.length > 1 && ranked[0].length === ranked[1].length) {
    throw new ResolveError(`ambiguous executable for ${command}`);
  }
  return ranked[0];
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "" || normalized.split("/").includes("..")) return "";
  return normalized;
}
