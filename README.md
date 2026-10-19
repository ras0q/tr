# tr

Tool Registry. Install a CLI published on GitHub Releases as an npm dependency.

tr serves package metadata and a launcher. [DotSlash](https://dotslash-cli.com/)
downloads the binary, checks its SHA-256, and runs it on your machine.

This server currently publishes `@tr/cli--cli` only (`gh` from
[cli/cli](https://github.com/cli/cli), latest release).

## Run locally

```sh
deno task start
```

The registry listens on `127.0.0.1:8787`.

## Install

`.npmrc`:

```
@tr:registry=http://127.0.0.1:8787/
```

```sh
npm install -D @tr/cli--cli
npx gh --version
```

`npm install` fetches metadata and the launcher. The `gh` binary is downloaded
when you run the command.

Development setup is in [CONTRIBUTING.md](CONTRIBUTING.md).
