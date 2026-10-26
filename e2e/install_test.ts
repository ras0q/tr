import { fileURLToPath } from "node:url";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { cloudflare } from "@cloudflare/vite-plugin";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL(".", import.meta.url));

test("npm install @tr/cli--cli in a package directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tr-e2e-"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;

  try {
    server = await createServer({
      root,
      mode: "test",
      plugins: [cloudflare({ persistState: false, inspectorPort: false })],
      server: { port: 0, open: false },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("registry did not listen on a TCP port");
    }
    const port = address.port;
    await copyFile(`${fixture}/package.json`, `${dir}/package.json`);
    const npmrc = await readFile(`${fixture}/.npmrc`, "utf8");
    await writeFile(
      `${dir}/.npmrc`,
      npmrc.replace("http://127.0.0.1:8787/", `http://127.0.0.1:${port}/`),
    );

    await promisify(execFile)("npm", ["install"], {
      cwd: dir,
      timeout: 240_000,
      env: {
        ...process.env,
        NPM_CONFIG_UPDATE_NOTIFIER: "false",
        npm_config_cache: `${dir}/.npm-cache`,
        npm_config_fetch_timeout: "120000",
        npm_config_fetch_retries: "0",
      },
    });

    const installed = JSON.parse(
      await readFile(`${dir}/node_modules/@tr/cli--cli/package.json`, "utf8"),
    );
    expect(installed).toMatchObject({ name: "@tr/cli--cli", bin: { gh: "gh.dotslash" } });
    const manifest = await readFile(`${dir}/node_modules/@tr/cli--cli/gh.dotslash`, "utf8");
    expect(manifest).toMatch(/^#!\/usr\/bin\/env dotslash\n/);
    const lock = await readFile(`${dir}/package-lock.json`, "utf8");
    expect(lock).toContain(`http://127.0.0.1:${port}/@tr/cli--cli/-/cli--cli-`);
    await stat(`${dir}/node_modules/.bin/gh`);
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(dir, { recursive: true });
    }
  }
}, 300_000);
