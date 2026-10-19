import * as v from "valibot";
import { type Release, ResolveError } from "./resolve.ts";

const ReleaseSchema = v.object({
  tag_name: v.string(),
  assets: v.array(v.object({
    name: v.string(),
    size: v.number(),
    digest: v.string(),
    browser_download_url: v.string(),
  })),
});

const LATEST = "https://api.github.com/repos/cli/cli/releases/latest";

export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<Release> {
  let response: Response;
  try {
    response = await fetchImpl(LATEST, {
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

  if (!response.ok) {
    throw new ResolveError(`GitHub release request failed: ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ResolveError("GitHub release request failed");
  }

  const parsed = v.safeParse(ReleaseSchema, body);
  if (!parsed.success) {
    throw new ResolveError("GitHub release did not match the expected shape");
  }
  return parsed.output;
}
