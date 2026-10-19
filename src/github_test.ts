import { fetchLatestRelease } from "./github.ts";

Deno.test("GitHub release schema", async (t) => {
  const release = {
    tag_name: "v2.102.0",
    html_url: "https://example.com/ignored",
    assets: [{
      name: "gh_2.102.0_linux_amd64.tar.gz",
      size: 10,
      digest: "sha256:" + "ab".repeat(32),
      browser_download_url: "https://example.com/gh.tar.gz",
      extra: true,
    }],
  };

  await t.assertSnapshot({
    parsed: await fetchLatestRelease(() => json(release)),
    httpStatus: await failure(() =>
      json({ tag_name: "v1.0.0", assets: [] }, 500)
    ),
    invalidJson: await failure(() =>
      Promise.resolve(new Response("nope", { status: 200 }))
    ),
    shape: await failure(() => json({ tag_name: 1, assets: [] })),
  });
});

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(Response.json(body, { status }));
}

async function failure(load: () => Promise<Response>): Promise<string> {
  try {
    await fetchLatestRelease(load);
    return "did not throw";
  } catch (error) {
    return error instanceof Error ? error.message : "unknown error";
  }
}
