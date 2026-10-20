import * as v from "valibot";
import {
  type GitHubCacheTtl,
  githubCacheTtlFrom,
  type GitHubReleaseCache,
} from "./github_cache.ts";
import {
  NotFoundError,
  type Release,
  releaseFrom,
  ResolveError,
} from "../core/resolve.ts";

const ReleaseShape = v.object({
  tag_name: v.string(),
  assets: v.array(v.object({
    name: v.string(),
    size: v.number(),
    digest: v.string(),
    browser_download_url: v.string(),
  })),
});

export function parseGitHubRelease(
  owner: string,
  repo: string,
  input: unknown,
): Release {
  const parsed = v.safeParse(ReleaseShape, input);
  if (!parsed.success) {
    throw new ResolveError("GitHub release did not match the expected shape");
  }
  const { tag_name: tag, assets } = parsed.output;
  return releaseFrom({
    source: `https://github.com/${owner}/${repo}`,
    tag,
    assets: assets.map((asset) => {
      const digest = /^sha256:([a-f0-9]{64})$/.exec(asset.digest);
      if (!digest) {
        throw new ResolveError(`unexpected digest for ${asset.name}`);
      }
      const url =
        `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset.name}`;
      if (asset.browser_download_url.toLowerCase() !== url.toLowerCase()) {
        throw new ResolveError(`unexpected url for ${asset.name}`);
      }
      return { name: asset.name, size: asset.size, digest: digest[1], url };
    }),
  });
}

/** Credentials apply only to GitHub API calls, never release asset downloads. */
export function createGitHubSource({
  token,
  cache,
  cacheTtl = githubCacheTtlFrom(),
  fetch: fetchImpl = fetch,
}: {
  token?: string;
  cache?: GitHubReleaseCache;
  cacheTtl?: GitHubCacheTtl;
  fetch?: typeof fetch;
} = {}) {
  const headers = new Headers({
    accept: "application/vnd.github+json",
    "user-agent": "tr",
    "x-github-api-version": "2022-11-28",
  });
  if (token) headers.set("authorization", `Bearer ${token}`);

  return async (owner: string, repo: string): Promise<Release> => {
    const url =
      `https://api.github.com/repos/${owner.toLowerCase()}/${repo.toLowerCase()}/releases/latest`;
    const cached = await cache?.get(url);
    const storedRelease = cached
      ? parseGitHubRelease(owner, repo, JSON.parse(cached.body))
      : undefined;
    const age = cached ? Date.now() - cached.checkedAt : undefined;
    if (storedRelease && age !== undefined && age >= 0 && age < cacheTtl) {
      return storedRelease;
    }
    // Conditional headers belong to this repository, not to the shared client.
    const requestHeaders = new Headers(headers);
    if (cached?.etag) requestHeaders.set("if-none-match", cached.etag);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ResolveError("GitHub release request failed");
    }

    if (response.status === 304 && cached && storedRelease) {
      await cache?.putIfUnchanged(url, {
        body: cached.body,
        etag: response.headers.get("etag") ?? cached.etag,
        checkedAt: Date.now(),
      }, cached.revision);
      return storedRelease;
    }
    if (response.status === 404) throw new NotFoundError(`${owner}/${repo}`);
    if (!response.ok) {
      throw new ResolveError(
        `GitHub release request failed: ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ResolveError("GitHub release request failed");
    }

    const release = parseGitHubRelease(owner, repo, body);
    await cache?.putIfUnchanged(url, {
      body: JSON.stringify(body),
      etag: response.headers.get("etag"),
      checkedAt: Date.now(),
    }, cached?.revision);
    return release;
  };
}
