import { Gunzip } from "fflate";
import { chooseExecutable, ResolveError } from "../core/resolve.ts";

const ZIP_TAIL = 65536 + 22;

/**
 * Zip stores its member names in the central directory at the end of the file.
 * tar.gz stores each name in a header that sits in front of that member's body,
 * so the scan stops at the executable header and leaves the body unread.
 */
export async function readExecutablePath(
  asset: {
    url: string;
    archive: "tar.gz" | "zip";
    os: string;
    size: number;
    assetName: string;
  },
  command: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const signal = AbortSignal.timeout(30_000);
  try {
    if (asset.archive === "zip") {
      return await executableInZip(asset, command, fetchImpl, signal);
    }
    const response = await openStream(asset.url, fetchImpl, signal);
    return await executableInTarGz(response.body, command, asset.os);
  } catch (error) {
    if (error instanceof ResolveError) throw error;
    throw new ResolveError(`asset download failed: ${asset.assetName}`);
  }
}

export function locateZipDirectory(
  tail: Uint8Array,
): { offset: number; length: number } {
  const min = Math.max(0, tail.length - ZIP_TAIL);
  for (let i = tail.length - 22; i >= min; i--) {
    if (
      tail[i] !== 0x50 || tail[i + 1] !== 0x4b || tail[i + 2] !== 0x05 ||
      tail[i + 3] !== 0x06
    ) continue;
    const comment = u16(tail, i + 20);
    if (i + 22 + comment !== tail.length) continue;
    const length = u32(tail, i + 12);
    const offset = u32(tail, i + 16);
    if (length === 0xffffffff || offset === 0xffffffff) {
      throw new ResolveError("unsupported zip64 archive");
    }
    return { offset, length };
  }
  throw new ResolveError("zip directory is missing");
}

export function zipMemberNames(directory: Uint8Array): string[] {
  const names: string[] = [];
  let pos = 0;
  while (pos + 46 <= directory.length) {
    if (
      directory[pos] !== 0x50 || directory[pos + 1] !== 0x4b ||
      directory[pos + 2] !== 0x01 || directory[pos + 3] !== 0x02
    ) break;
    const nameLen = u16(directory, pos + 28);
    const extraLen = u16(directory, pos + 30);
    const commentLen = u16(directory, pos + 32);
    const name = new TextDecoder().decode(
      directory.subarray(pos + 46, pos + 46 + nameLen),
    );
    if (!name.endsWith("/")) names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export async function executableInTarGz(
  stream: ReadableStream<Uint8Array>,
  command: string,
  os: string,
): Promise<string> {
  const reader = stream.getReader();
  const queue = new ByteQueue();
  let finished = false;
  const gunzip = new Gunzip((chunk) => {
    queue.push(chunk.slice());
  });
  const want = new Set(
    os === "windows"
      ? [command.toLowerCase(), `${command.toLowerCase()}.exe`]
      : [command.toLowerCase()],
  );
  let pendingName: string | undefined;

  const fill = async (n: number) => {
    while (queue.length < n) {
      if (finished) {
        throw new ResolveError(`no executable named ${command}`);
      }
      const next = await reader.read();
      if (next.done) {
        finished = true;
        gunzip.push(new Uint8Array(), true);
        continue;
      }
      gunzip.push(next.value, false);
    }
  };

  try {
    for (;;) {
      await fill(512);
      const block = queue.take(512);
      if (block.every((byte) => byte === 0)) {
        throw new ResolveError(`no executable named ${command}`);
      }
      if (!tarChecksum(block)) {
        throw new ResolveError("archive member list failed");
      }
      const header = tarHeader(block);
      if (header.type === "L") {
        await fill(padded(header.size));
        const body = queue.take(header.size);
        queue.drop(padded(header.size) - header.size);
        pendingName = new TextDecoder().decode(body).replace(/\0+$/, "");
        continue;
      }
      const name = pendingName ?? header.name;
      pendingName = undefined;
      const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
      if ((header.type === "0" || header.type === "\0") && want.has(base)) {
        return chooseExecutable([name], command, os);
      }
      await discard(queue, fill, padded(header.size));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function executableInZip(
  asset: { url: string; os: string; size: number; assetName: string },
  command: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const located = await locate(asset.url, fetchImpl, signal);
  const tailLength = Math.min(asset.size, ZIP_TAIL);
  const tailStart = asset.size - tailLength;
  const tail = await readRange(
    located,
    tailStart,
    asset.size - 1,
    asset,
    fetchImpl,
    signal,
  );
  const directory = locateZipDirectory(tail);
  const local = directory.offset - tailStart;
  const bytes = local >= 0 && local + directory.length <= tail.length
    ? tail.subarray(local, local + directory.length)
    : await readRange(
      located,
      directory.offset,
      directory.offset + directory.length - 1,
      asset,
      fetchImpl,
      signal,
    );
  return chooseExecutable(zipMemberNames(bytes), command, asset.os);
}

async function openStream(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Response & { body: ReadableStream<Uint8Array> }> {
  const first = await fetchImpl(url, { redirect: "manual", signal });
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get("location");
    await first.body?.cancel();
    if (!location) throw new ResolveError(`asset download failed: ${url}`);
    const next = await fetchImpl(new URL(location, url), {
      redirect: "follow",
      signal,
    });
    if (!next.ok || !next.body) {
      await next.body?.cancel();
      throw new ResolveError(`asset download failed: ${next.status}`);
    }
    return next as Response & { body: ReadableStream<Uint8Array> };
  }
  if (!first.ok || !first.body) {
    await first.body?.cancel();
    throw new ResolveError(`asset download failed: ${first.status}`);
  }
  return first as Response & { body: ReadableStream<Uint8Array> };
}

async function locate(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchImpl(url, { redirect: "manual", signal });
  const location = response.headers.get("location");
  await response.body?.cancel();
  if (location && response.status >= 300 && response.status < 400) {
    return new URL(location, url).href;
  }
  if (response.ok) return url;
  throw new ResolveError(`asset download failed: ${response.status}`);
}

async function readRange(
  url: string,
  start: number,
  end: number,
  asset: { size: number; assetName: string },
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetchImpl(url, {
    headers: { range: `bytes=${start}-${end}` },
    signal,
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new ResolveError(`asset range failed: ${asset.assetName}`);
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    response.headers.get("content-range") ?? "",
  );
  if (!match || Number(match[3]) !== asset.size) {
    await response.body?.cancel();
    throw new ResolveError(`unexpected size for ${asset.assetName}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== end - start + 1) {
    throw new ResolveError(`unexpected size for ${asset.assetName}`);
  }
  return bytes;
}

function tarHeader(
  block: Uint8Array,
): { name: string; size: number; type: string } {
  const magic = text(block, 257, 263);
  const prefix = magic.startsWith("ustar") ? text(block, 345, 500) : "";
  const name = text(block, 0, 100);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size: octal(block, 124, 136),
    type: String.fromCharCode(block[156] || 0x30),
  };
}

function tarChecksum(block: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += i >= 148 && i < 156 ? 32 : block[i];
  }
  return sum === octal(block, 148, 156);
}

function text(block: Uint8Array, start: number, end: number): string {
  const bytes = block.subarray(start, end);
  const nul = bytes.indexOf(0);
  return new TextDecoder().decode(nul === -1 ? bytes : bytes.subarray(0, nul));
}

function octal(block: Uint8Array, start: number, end: number): number {
  const raw = text(block, start, end).trim();
  if (raw === "") return 0;
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ResolveError("archive member list failed");
  }
  return value;
}

function padded(size: number): number {
  const rem = size % 512;
  return rem === 0 ? size : size + (512 - rem);
}

async function discard(
  queue: ByteQueue,
  fill: (n: number) => Promise<void>,
  n: number,
): Promise<void> {
  let left = n;
  while (left > 0) {
    const step = Math.min(left, 8192);
    await fill(step);
    queue.drop(step);
    left -= step;
  }
}

class ByteQueue {
  private parts: Uint8Array[] = [];
  private start = 0;
  length = 0;

  push(chunk: Uint8Array) {
    if (chunk.length === 0) return;
    this.parts.push(chunk);
    this.length += chunk.length;
  }

  take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    this.copy(out, n);
    return out;
  }

  drop(n: number) {
    this.copy(null, n);
  }

  private copy(out: Uint8Array | null, n: number) {
    if (n > this.length) throw new ResolveError("archive member list failed");
    let filled = 0;
    while (filled < n) {
      const part = this.parts[0];
      const available = part.length - this.start;
      const take = Math.min(available, n - filled);
      if (out) out.set(part.subarray(this.start, this.start + take), filled);
      filled += take;
      this.start += take;
      this.length -= take;
      if (this.start === part.length) {
        this.parts.shift();
        this.start = 0;
      }
    }
  }
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}
