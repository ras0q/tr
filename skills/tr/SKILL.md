---
name: tr
description: Manage GitHub Release CLI tools in package.json using the tr npm registry. Use when adding or migrating CLI tools to project devDependencies and npm scripts with @tr packages.
---

# tr

Use tr to manage CLI tools from public GitHub Releases in `package.json`.
Requires Node.js 20+ and npm 7+.

1. Identify the tool's GitHub owner and repository. Its package name is
   `@tr/<owner>--<repo>` in lowercase; its executable name may differ.
2. Add the scoped registry to the project's `.npmrc`, preserving other settings:

   ```ini
   @tr:registry=https://tr.ras0q.com
   ```

   Keep an existing project-specific `@tr` registry URL.

3. Install the tool as a development dependency, updating the lockfile with npm:

   ```sh
   npm install --save-dev @tr/cli--cli
   ```

4. Use the executable in npm scripts or through `npx`. For example,
   `@tr/cli--cli` provides `gh`:

   ```json
   { "scripts": { "pr:list": "gh pr list" } }
   ```

   Confirm the executable name with `npm view @tr/cli--cli bin` when needed.
   Verify installation with a harmless command such as `npx gh --version`.

New packages resolve the latest public GitHub Release. Exact versions already
published to tr remain available; unpublished older releases cannot be fetched.
If a requested version is unavailable, report it instead of changing versions.

Tools run through DotSlash, which downloads and verifies the platform binary on
first use and caches it. Use npm scripts or `npx` so the interpreter is on `PATH`.
