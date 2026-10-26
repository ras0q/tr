# tr (Tool Registry)

Install CLI tools from GitHub Releases and manage them in your `package.json`.

![demo](docs/demo.gif)

Packages are named `@tr/<owner>--<repo>`. For example, `@tr/cli--cli` installs
GitHub CLI (`gh`) from [cli/cli](https://github.com/cli/cli).

## Usage

With Node.js 20+ and npm 7+, add the preview registry to your project's
`.npmrc`:

```ini
@tr:registry=https://tr.ras0q.com
```

Install and run a tool:

```sh
npm install --save-dev @tr/cli--cli
npx gh --version
```

Run tools through `npx` or npm scripts so their interpreter is on `PATH`.

## How it works

tr packages a Meta's [DotSlash](https://dotslash-cli.com/) manifest instead of
the tool's binary. On first use, DotSlash downloads the binary for your OS and
architecture, verifies its SHA-256, and caches it for subsequent runs.

```mermaid
sequenceDiagram
  participant User as User's machine
  participant tr as tr registry
  participant GitHub as GitHub Releases
  Note over User: npm install @tr/cli--cli
  User->>tr: GET /@tr%2fcli--cli
  tr->>GitHub: Resolve release and executable
  GitHub-->>tr: Release metadata and archive data
  tr-->>User: npm package with DotSlash manifest
  Note over User: npx gh
  User->>GitHub: DotSlash downloads the platform binary
  GitHub-->>User: Binary asset
  Note over User: DotSlash verifies, caches, and runs gh
```

New packages resolve the latest public GitHub Release. Previously published
exact versions remain available; looking up unpublished older releases is not
yet supported.

For local development and contribution guidelines, see
[CONTRIBUTING.md](CONTRIBUTING.md).
