# Contributing

Ask before adding product behavior that [README.md](README.md) does not specify.

Production modules under `src/` use Node.js built-ins (`node:`) and Web APIs
that Node implements.

Write documentation and comments in English. Write lines out to the width
`deno task check` keeps. A function that only forwards to another function does
not get its own name.

Add a dependency when it parses or produces something this program would
otherwise get wrong. A test-only library waits until the same boilerplate is the
body of more than one test.
