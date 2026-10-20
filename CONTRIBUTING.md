# Contributing

## Local development

Start the registry:

```sh
deno task start
# → http://127.0.0.1:8787/
```

Set `TR_GITHUB_TOKEN` in the process environment to authenticate GitHub API
requests. Without it, local development uses unauthenticated requests. The token
is sent only to the GitHub API, never to release asset downloads.

## Cloudflare staging

Run the local Workers runtime with simulated D1 and R2:

```sh
deno task cf dev
# → http://127.0.0.1:8788/
```

## Contribution guidelines

Ask before adding product behavior that [README.md](README.md) does not specify.

Production modules under `src/` use Node.js built-ins (`node:`) and Web APIs
that Node implements.

Write documentation and comments in English. Write lines out to the width
`deno task check` keeps. A function that only forwards to another function does
not get its own name.

Prefer preventing bugs through structural and type constraints over adding
explicit tests. Validate external inputs at boundaries and make invalid states
unrepresentable internally. Do not add tests by default; keep existing checks
passing.

Add a dependency when it parses or produces something this program would
otherwise get wrong. A test-only library waits until the same boilerplate is the
body of more than one test.
