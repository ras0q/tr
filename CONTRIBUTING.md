# Contributing

## Local development

Use a Node.js version supported by `package.json` and install dependencies with
`npm ci`.

Start the registry in the local Workers runtime with simulated D1 and R2:

```sh
npm start
# → http://127.0.0.1:8787/
```

Set `TR_GITHUB_TOKEN` in `.dev.vars` to authenticate GitHub API requests:

```sh
TR_GITHUB_TOKEN=your-token
```

Without it, local development uses unauthenticated requests. The token is sent
only to the GitHub API, never to release asset downloads. Local D1 and R2 data
persists in `.cloudflare/`.

Run `npm run e2e` to install a package against a temporary Workers registry.
The test uses the same Vite configuration with isolated, nonpersistent D1 and R2.

Run `npm run check` for formatting, linting, type checks, and unit tests through
Vite+. Use `npm run fmt` to format and `npm run build` to build the Worker.

## Contribution guidelines

Ask before adding product behavior that [README.md](README.md) does not specify.

Production modules under `src/` use Node.js built-ins (`node:`) and Web APIs
that Node implements.

Write documentation and comments in English. Write lines out to the width
`npm run check` keeps. A function that only forwards to another function does
not get its own name.

Prefer preventing bugs through structural and type constraints over adding
explicit tests. Validate external inputs at boundaries and make invalid states
unrepresentable internally. Do not add tests by default; keep existing checks
passing.

Add a dependency when it parses or produces something this program would
otherwise get wrong. A test-only library waits until the same boilerplate is the
body of more than one test.
