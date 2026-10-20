import { type ToolManifest } from "../core/resolve.ts";

/** The DotSlash manifest fields emitted by this adapter. */
type DotslashManifest = {
  name: string;
  platforms: Record<string, {
    size: number;
    hash: "sha256";
    digest: string;
    format?: "tar.gz" | "zip";
    path: string;
    providers: { url: string }[];
  }>;
};

export function renderDotslash(resolved: ToolManifest): string {
  const platforms: DotslashManifest["platforms"] = {};
  const ordered = [...resolved.platforms].sort((a, b) =>
    a.platform.localeCompare(b.platform)
  );
  for (const item of ordered) {
    platforms[item.platform] = {
      size: item.size,
      hash: "sha256",
      digest: item.digest,
      ...(item.archive === "raw" ? {} : { format: item.archive }),
      path: item.path,
      providers: [{ url: item.url }],
    };
  }
  const manifest = {
    name: resolved.command,
    platforms,
  } satisfies DotslashManifest;
  const body = JSON.stringify(manifest, null, 2);
  return `#!/usr/bin/env dotslash\n${body}\n`;
}
