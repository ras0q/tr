import { expect, test } from "vite-plus/test";
import { createGitHubSource } from "./github.ts";

test("GitHub release schema", async () => {
  const release = {
    tag_name: "v2.102.0",
    html_url: "https://example.com/ignored",
    assets: [
      {
        name: "gh_2.102.0_linux_amd64.tar.gz",
        size: 10,
        digest: "sha256:" + "ab".repeat(32),
        browser_download_url:
          "https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_linux_amd64.tar.gz",
        extra: true,
      },
    ],
  };
  const message = async (response: Response) => {
    try {
      await createGitHubSource({ fetch: () => Promise.resolve(response) })("cli", "cli");
      return "did not throw";
    } catch (error) {
      return error instanceof Error ? error.message : "unknown error";
    }
  };

  expect({
    parsed: await createGitHubSource({
      fetch: () => Promise.resolve(Response.json(release)),
    })("cli", "cli"),
    httpStatus: await message(Response.json({ tag_name: "v1.0.0", assets: [] }, { status: 500 })),
    invalidJson: await message(new Response("nope", { status: 200 })),
    shape: await message(Response.json({ tag_name: 1, assets: [] })),
    unexpectedUrl: await message(
      Response.json({
        ...release,
        assets: [
          {
            ...release.assets[0],
            browser_download_url: "https://example.com/gh.tar.gz",
          },
        ],
      }),
    ),
    unexpectedDigest: await message(
      Response.json({
        ...release,
        assets: [{ ...release.assets[0], digest: "nope" }],
      }),
    ),
  }).toMatchSnapshot();
});
