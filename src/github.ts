import {
  NotFoundError,
  parseRelease,
  type Release,
  ResolveError,
} from "./resolve.ts";

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

  return parseRelease(owner, repo, body);
}

export async function fetchAsset(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok) {
      throw new ResolveError(`asset download failed: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ResolveError) throw error;
    throw new ResolveError(`asset download failed: ${url}`);
  }
}
