# tr

Tool Registry. Install a CLI published on GitHub Releases as an npm dependency.

tr serves package metadata and a launcher. [DotSlash](https://dotslash-cli.com/)
downloads the binary, checks its SHA-256, and runs it on your machine.

`@tr/<owner>--<repo>` is the latest GitHub Release of that repository. The
registry reads asset names to choose an archive per OS and architecture, copies
each asset's size and SHA-256 from the release metadata, and reads member names
once to find the executable. `@tr/cli--cli` is `gh` from
[cli/cli](https://github.com/cli/cli).

## Run locally

```sh
deno task start
```

The registry listens on `127.0.0.1:8787`. The first request for a package
version stores its manifest in `tr.sqlite`.

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
