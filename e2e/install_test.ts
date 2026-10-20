import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL(".", import.meta.url));

Deno.test("npm install @tr/cli--cli in a package directory", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tr-e2e-" });
  const server = new Deno.Command(Deno.execPath(), {
    args: [
      "serve",
      "--allow-net",
      "--allow-env=TR_GITHUB_TOKEN",
      "--allow-read",
      "--allow-write",
      "--config",
      `${root}/deno.json`,
      "--host=127.0.0.1",
      "--port=0",
      `${root}/src/main.ts`,
    ],
    // Fresh storage verifies this generator without replacing published artifacts.
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
    env: { ...Deno.env.toObject(), NO_COLOR: "1" },
  }).spawn();
  discard(server.stdout);

  try {
    // Port 0 avoids clashing with `deno task start` on 8787.
    const port = await listenPort(server.stderr);
    await Deno.copyFile(`${fixture}/package.json`, `${dir}/package.json`);
    const npmrc = await Deno.readTextFile(`${fixture}/.npmrc`);
    await Deno.writeTextFile(
      `${dir}/.npmrc`,
      npmrc.replace("http://127.0.0.1:8787/", `http://127.0.0.1:${port}/`),
    );

    const install = await new Deno.Command("npm", {
      args: ["install"],
      cwd: dir,
      env: {
        ...Deno.env.toObject(),
        NPM_CONFIG_UPDATE_NOTIFIER: "false",
        npm_config_cache: `${dir}/.npm-cache`,
        npm_config_fetch_timeout: "900000",
        npm_config_fetch_retries: "0",
      },
    }).output();
    if (install.code !== 0) {
      throw new Error(decode(install.stderr) || decode(install.stdout));
    }

    const installed = JSON.parse(
      await Deno.readTextFile(`${dir}/node_modules/@tr/cli--cli/package.json`),
    );
    if (
      installed.name !== "@tr/cli--cli" ||
      installed.bin?.gh !== "gh.dotslash"
    ) {
      throw new Error(
        `unexpected package metadata: ${JSON.stringify(installed)}`,
      );
    }
    const manifest = await Deno.readTextFile(
      `${dir}/node_modules/@tr/cli--cli/gh.dotslash`,
    );
    if (!manifest.startsWith("#!/usr/bin/env dotslash\n")) {
      throw new Error("manifest is missing the dotslash shebang");
    }
    const lock = await Deno.readTextFile(`${dir}/package-lock.json`);
    if (!lock.includes(`http://127.0.0.1:${port}/@tr/cli--cli/-/cli--cli-`)) {
      throw new Error("lockfile does not point at the tr registry");
    }
    await Deno.stat(`${dir}/node_modules/.bin/gh`);
  } finally {
    server.kill("SIGTERM");
    await server.status;
    await Deno.remove(dir, { recursive: true });
  }
});

async function listenPort(stdout: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("registry did not listen")),
      15_000,
    );
  });
  const reading = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const found = buffered.match(/127\.0\.0\.1:(\d+)/);
      if (found) {
        discardReader(reader);
        return Number(found[1]);
      }
    }
    throw new Error(`registry exited before listening\n${buffered}`);
  })();
  reading.catch(() => {});
  try {
    return await Promise.race([reading, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function discard(stream: ReadableStream<Uint8Array>): void {
  discardReader(stream.getReader());
}

function discardReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void (async () => {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  })();
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
