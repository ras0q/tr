import { ResolveError } from "./resolve.ts";

export type Architecture = "amd64" | "arm64";
export type OperatingSystem = "linux" | "darwin" | "windows";

// Bounds PE offsets and fat Mach-O tables without buffering the whole binary.
export const MAX_EXECUTABLE_HEADER = 64 * 1024;

/** Returns supported CPUs, never inferring an architecture from a filename. */
export async function readArchitectures(
  prefix: (length: number) => Promise<Uint8Array>,
  os: OperatingSystem,
): Promise<Architecture[]> {
  async function header(length: number): Promise<DataView> {
    if (length > MAX_EXECUTABLE_HEADER) {
      throw new ResolveError("executable header exceeds the supported size");
    }
    const bytes = await prefix(length);
    if (bytes.length < length) {
      throw new ResolveError("truncated executable header");
    }
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  const first = await prefix(4);
  if (first.length < 4) return [];
  const magic = new DataView(first.buffer, first.byteOffset, first.byteLength).getUint32(0);
  if (os === "linux" && magic === 0x7f454c46) {
    const elf = await header(20);
    if (elf.getUint8(4) !== 2 || ![1, 2].includes(elf.getUint8(5))) return [];
    const little = elf.getUint8(5) === 1;
    if (![2, 3].includes(elf.getUint16(16, little))) return [];
    return cpu(elf.getUint16(18, little), 62, 183);
  }
  if (os === "windows" && first[0] === 0x4d && first[1] === 0x5a) {
    const dos = await header(64);
    const offset = dos.getUint32(60, true);
    if (offset < 64) throw new ResolveError("invalid PE header offset");
    const pe = await header(offset + 6);
    if (pe.getUint32(offset) !== 0x50450000) return [];
    return cpu(pe.getUint16(offset + 4, true), 0x8664, 0xaa64);
  }
  if (os === "darwin") {
    if (magic === 0xfeedfacf || magic === 0xcffaedfe) {
      const mach = await header(8);
      return cpu(mach.getUint32(4, magic === 0xcffaedfe), 0x01000007, 0x0100000c);
    }
    if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) {
      const little = magic === 0xbebafeca || magic === 0xbfbafeca;
      const stride = magic === 0xcafebabf || magic === 0xbfbafeca ? 32 : 20;
      const fat = await header(8);
      const count = fat.getUint32(4, little);
      const table = await header(8 + count * stride);
      const architectures = new Set<Architecture>();
      for (let i = 0; i < count; i++) {
        for (const arch of cpu(table.getUint32(8 + i * stride, little), 0x01000007, 0x0100000c)) {
          architectures.add(arch);
        }
      }
      return [...architectures];
    }
  }
  return [];
}

function cpu(value: number, amd64: number, arm64: number): Architecture[] {
  if (value === amd64) return ["amd64"];
  if (value === arm64) return ["arm64"];
  return [];
}
