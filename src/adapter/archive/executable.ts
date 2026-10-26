import { Gunzip, Inflate } from "fflate";
import {
  MAX_EXECUTABLE_HEADER,
  type OperatingSystem,
  readArchitectures,
} from "../../core/executable.ts";
import {
  chooseExecutable,
  type ExecutableAsset,
  type ExecutableInfo,
  NoExecutableError,
  ResolveError,
} from "../../core/resolve.ts";

const ZIP_TAIL = 65536 + 22;

/** Reads archive metadata and only the executable prefix needed for CPU detection. */
export async function readExecutable(
  asset: ExecutableAsset,
  command: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutableInfo> {
  const signal = AbortSignal.timeout(30_000);
  try {
    if (asset.archive === "zip") {
      return await executableInZip(asset, command, fetchImpl, signal);
    }
    const response = await openStream(asset.url, fetchImpl, signal);
    if (asset.archive === "tar.gz") {
      return await executableInTarGz(response.body, command, asset.os);
    }
    const reader = response.body.getReader();
    let bytes = new Uint8Array();
    try {
      const architectures = await readArchitectures(async (length) => {
        while (bytes.length < length) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes = appendPrefix(bytes, value);
        }
        return bytes.subarray(0, length);
      }, asset.os);
      return { path: asset.assetName, architectures };
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (error instanceof ResolveError) throw error;
    throw new ResolveError(`asset download failed: ${asset.assetName}`);
  }
}

export function locateZipDirectory(tail: Uint8Array): { offset: number; length: number } {
  const min = Math.max(0, tail.length - ZIP_TAIL);
  for (let i = tail.length - 22; i >= min; i--) {
    if (tail[i] !== 0x50 || tail[i + 1] !== 0x4b || tail[i + 2] !== 0x05 || tail[i + 3] !== 0x06)
      continue;
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
  return zipMembers(directory).map((member) => member.name);
}

type ZipMember = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
};

function zipMembers(directory: Uint8Array): ZipMember[] {
  const members: ZipMember[] = [];
  let pos = 0;
  while (pos + 46 <= directory.length) {
    if (u32(directory, pos) !== 0x02014b50) break;
    const nameLen = u16(directory, pos + 28);
    const extraLen = u16(directory, pos + 30);
    const commentLen = u16(directory, pos + 32);
    const end = pos + 46 + nameLen + extraLen + commentLen;
    if (end > directory.length) {
      throw new ResolveError("truncated zip directory");
    }
    const name = new TextDecoder().decode(directory.subarray(pos + 46, pos + 46 + nameLen));
    const member = {
      name,
      method: u16(directory, pos + 10),
      flags: u16(directory, pos + 8),
      compressedSize: u32(directory, pos + 20),
      size: u32(directory, pos + 24),
      offset: u32(directory, pos + 42),
    };
    if ([member.compressedSize, member.size, member.offset].includes(0xffffffff)) {
      throw new ResolveError("unsupported zip64 archive");
    }
    if (!name.endsWith("/")) members.push(member);
    pos = end;
  }
  return members;
}

export async function executableInTarGz(
  stream: ReadableStream<Uint8Array>,
  command: string,
  os: OperatingSystem,
): Promise<ExecutableInfo> {
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
        throw new NoExecutableError(`no executable named ${command}`);
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
        throw new NoExecutableError(`no executable named ${command}`);
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
        const path = chooseExecutable([name], command, os);
        let bytes = new Uint8Array();
        const architectures = await readArchitectures(async (length) => {
          const wanted = Math.min(length, header.size);
          if (wanted > bytes.length) {
            await fill(wanted - bytes.length);
            bytes = appendPrefix(bytes, queue.take(wanted - bytes.length));
          }
          return bytes;
        }, os);
        return { path, architectures };
      }
      await discard(queue, fill, padded(header.size));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function executableInZip(
  asset: ExecutableAsset,
  command: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<ExecutableInfo> {
  const located = await locate(asset.url, fetchImpl, signal);
  const tailLength = Math.min(asset.size, ZIP_TAIL);
  const tailStart = asset.size - tailLength;
  const tail = await readRange(located, tailStart, asset.size - 1, asset, fetchImpl, signal);
  const directory = locateZipDirectory(tail);
  const local = directory.offset - tailStart;
  const bytes =
    local >= 0 && local + directory.length <= tail.length
      ? tail.subarray(local, local + directory.length)
      : await readRange(
          located,
          directory.offset,
          directory.offset + directory.length - 1,
          asset,
          fetchImpl,
          signal,
        );
  const members = zipMembers(bytes);
  const path = chooseExecutable(
    members.map((member) => member.name),
    command,
    asset.os,
  );
  const selectedMember = members.find(
    (item) => item.name.replaceAll("\\", "/").replace(/^\.\//, "") === path,
  );
  if (!selectedMember) {
    throw new NoExecutableError(`no executable named ${command}`);
  }
  const member: ZipMember = selectedMember;
  if ((member.flags & 1) !== 0 || ![0, 8].includes(member.method)) {
    throw new ResolveError("unsupported zip compression or encryption");
  }
  async function range(start: number, end: number): Promise<Uint8Array> {
    if (start < 0 || end < start || end >= asset.size) {
      throw new ResolveError("invalid zip member range");
    }
    if (start >= tailStart) {
      return tail.subarray(start - tailStart, end - tailStart + 1);
    }
    return await readRange(located, start, end, asset, fetchImpl, signal);
  }
  // One range usually contains both the local header and enough compressed data.
  let localHeader = await range(member.offset, Math.min(asset.size - 1, member.offset + 16384 - 1));
  if (localHeader.length < 30 || u32(localHeader, 0) !== 0x04034b50) {
    throw new ResolveError("invalid zip local header");
  }
  if (u16(localHeader, 8) !== member.method || (u16(localHeader, 6) & 1) !== 0) {
    throw new ResolveError("inconsistent zip local header");
  }
  const dataOffset = 30 + u16(localHeader, 26) + u16(localHeader, 28);
  if (dataOffset > localHeader.length) {
    localHeader = await range(member.offset, member.offset + dataOffset - 1);
  }
  const dataStart = member.offset + dataOffset;
  if (dataStart + member.compressedSize > asset.size) {
    throw new ResolveError("invalid zip member size");
  }
  let prefix = new Uint8Array();
  let consumed = 0;
  const inflater = new Inflate((chunk) => {
    prefix = appendPrefix(prefix, chunk);
  });
  function consume(chunk: Uint8Array) {
    consumed += chunk.length;
    if (member.method === 0) prefix = appendPrefix(prefix, chunk);
    else inflater.push(chunk, consumed === member.compressedSize);
  }
  consume(localHeader.subarray(dataOffset, dataOffset + member.compressedSize));
  const architectures = await readArchitectures(async (length) => {
    while (prefix.length < Math.min(length, member.size) && consumed < member.compressedSize) {
      const count = Math.min(16384, member.compressedSize - consumed);
      consume(await range(dataStart + consumed, dataStart + consumed + count - 1));
    }
    return prefix.subarray(0, Math.min(length, member.size));
  }, asset.os);
  return { path, architectures };
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

async function locate(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<string> {
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
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  if (
    !match ||
    Number(match[1]) !== start ||
    Number(match[2]) !== end ||
    Number(match[3]) !== asset.size
  ) {
    await response.body?.cancel();
    throw new ResolveError(`unexpected size for ${asset.assetName}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== end - start + 1) {
    throw new ResolveError(`unexpected size for ${asset.assetName}`);
  }
  return bytes;
}

function appendPrefix(prefix: Uint8Array, chunk: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = Math.min(MAX_EXECUTABLE_HEADER, prefix.length + chunk.length);
  const combined = new Uint8Array(length);
  combined.set(prefix.subarray(0, length));
  combined.set(chunk.subarray(0, length - prefix.length), prefix.length);
  return combined;
}

function tarHeader(block: Uint8Array): { name: string; size: number; type: string } {
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
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}
