import {
  type Repository,
  ResolveError,
  type ToolManifest,
} from "../../core/resolve.ts";

declare const npmScope: unique symbol;

/** A validated namespace that is safe to embed in registry routes. */
export type NpmScope = string & { readonly [npmScope]: never };

export type NpmPackage = ToolManifest & {
  packageName: string;
  version: string;
};

const PART = /^[a-z0-9_.-]+$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function npmScopeFrom(scope: string): NpmScope {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) {
    throw new Error("npm scope must be a lowercase scope such as @tr");
  }
  return scope as NpmScope;
}

/** The first `--` separates the source owner from the repository name. */
export function parsePackageName(
  name: string,
): Repository | undefined {
  const sep = name.indexOf("--");
  if (sep <= 0 || sep + 2 >= name.length) return undefined;
  const owner = name.slice(0, sep);
  const repo = name.slice(sep + 2);
  if (!PART.test(owner) || !PART.test(repo)) return undefined;
  return { owner, repo };
}

export function parseTarballName(
  name: string,
  file: string,
): { id: Repository; version: string } | undefined {
  const id = parsePackageName(name);
  if (!id) return undefined;
  const prefix = `${id.owner}--${id.repo}-`;
  if (!file.startsWith(prefix) || !file.endsWith(".tgz")) return undefined;
  const version = file.slice(prefix.length, -".tgz".length);
  if (!SEMVER.test(version)) return undefined;
  return { id, version };
}

export function createNpmPackage(
  scope: NpmScope,
  id: Repository,
  manifest: ToolManifest,
): NpmPackage {
  const version = manifest.tag.startsWith("v")
    ? manifest.tag.slice(1)
    : manifest.tag;
  if (!SEMVER.test(version)) {
    throw new ResolveError(`unsupported npm tag ${manifest.tag}`);
  }
  return {
    ...manifest,
    packageName: `${scope}/${id.owner}--${id.repo}`,
    version,
  };
}
