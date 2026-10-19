# Contributing

## Toolchain

Deno formats, lints, tests, and serves the local registry. Production modules
under `src/` do not call Deno APIs. `src/main.ts` exports a Web `fetch` handler;
`deno serve` is only the local host.

Use Node.js built-ins (`node:`) and Web APIs that Node implements. Do not add a
runtime-specific HTTP server.

## Commands

```sh
deno task start
deno task test
deno task e2e
deno task check
deno outdated --latest
```

`deno task check` runs `deno fmt --check`, `deno lint`, and `deno test`.
`deno task test` skips `e2e/`. `deno task e2e` copies `e2e/package.json` to a
temp directory, points `.npmrc` at a registry on a free port, and runs
`npm install`. It needs network access to GitHub and to the npm registry for
`fb-dotslash`. The registry downloads each selected release archive to find the
executable, so the test takes about as long as those downloads.

Update snapshots after an intentional output change, then review the `.snap`
diff:

```sh
deno test --update-snapshots
```

## Layout

Unit tests live next to the module they exercise (`src/foo_test.ts`). Prefer a
snapshot over a list of assertions when the value is a document or a structured
response.

## Constraints

- Write documentation and comments in English.
- Validate external JSON with Valibot.
- Generated package launchers are `.mjs`.
- The same name and version must keep producing the same tarball bytes. The
  first successful build of a version is reused for the life of the process.
