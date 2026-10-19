import { gunzipSync, unzipSync } from "fflate";
import { extract } from "tar-stream";

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
