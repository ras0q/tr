import * as v from "valibot";
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

export async function fetchLatestRelease(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Release> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "tr",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ResolveError("GitHub release request failed");
  }

  if (response.status === 404) throw new NotFoundError(`${owner}/${repo}`);
  if (!response.ok) {
    throw new ResolveError(`GitHub release request failed: ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ResolveError("GitHub release request failed");
  }

  return parseGitHubRelease(owner, repo, body);
}
