import { gunzipSync, unzipSync } from "fflate";
import { extract } from "tar-stream";
import { ResolveError } from "./resolve.ts";

/** Formats whose member list we can read. DotSlash accepts more than this. */
export type ListableArchive = "tar.gz" | "zip";

export async function listArchive(
  bytes: Uint8Array,
  format: ListableArchive,
): Promise<string[]> {
  if (format === "zip") {
    return Object.keys(unzipSync(bytes)).filter((name) => !name.endsWith("/"));
  }
  return await listTar(gunzipSync(bytes));
}

/**
 * The command is the asset-name prefix aqua would turn into {{.Version}}.
 * Inside the archive, the executable is the file with that basename.
 * gh's Windows zip has no top-level directory, so the path cannot be guessed
 * from the asset name alone.
 */
export function chooseExecutable(
  paths: readonly string[],
  command: string,
  os: string,
): string {
  const files = paths.map(normalizePath).filter((path) => path !== "");
  const want = new Set(
    os === "windows"
      ? [command.toLowerCase(), `${command.toLowerCase()}.exe`]
      : [command.toLowerCase()],
  );
  const matches = files.filter((path) =>
    want.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase())
  );
  const exe = matches.filter((path) => path.toLowerCase().endsWith(".exe"));
  const pool = os === "windows" && exe.length > 0 ? exe : matches;
  const binned = pool.filter((path) => path.split("/").includes("bin"));
  const ranked = (binned.length > 0 ? binned : pool).toSorted((a, b) =>
    a.length - b.length || a.localeCompare(b)
  );
  if (ranked.length === 0) {
    throw new ResolveError(`no executable named ${command}`);
  }
  if (ranked.length > 1 && ranked[0].length === ranked[1].length) {
    throw new ResolveError(`ambiguous executable for ${command}`);
  }
  return ranked[0];
}

function listTar(bytes: Uint8Array): Promise<string[]> {
  const archive = extract();
  const names: string[] = [];
  const done = new Promise<string[]>((resolve, reject) => {
    archive.on("entry", (header, stream, next) => {
      if (header.type === "file") names.push(header.name);
      stream.on("end", next);
      stream.on("error", reject);
      stream.resume();
    });
    archive.on("finish", () => resolve(names));
    archive.on("error", reject);
  });
  archive.end(bytes);
  return done;
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "" || normalized.split("/").includes("..")) return "";
  return normalized;
}
