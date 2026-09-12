// Snapshot cache using Brotli by default and Zstandard when the runtime supports it (docs/reference/spec.md section 2.1 and section 7).
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import * as zlib from "node:zlib";

export type Codec = "br" | "zstd";

interface ZstdCapable {
  zstdCompressSync?: (buf: Buffer, opts?: unknown) => Buffer;
  zstdDecompressSync?: (buf: Buffer) => Buffer;
}

/** Prefer Zstandard when the runtime provides it; otherwise use Brotli. */
export function preferredCodec(): Codec {
  const z = zlib as unknown as ZstdCapable;
  return typeof z.zstdCompressSync === "function" && typeof z.zstdDecompressSync === "function" ? "zstd" : "br";
}

export function compress(text: string, codec: Codec = preferredCodec()): Buffer {
  const buf = Buffer.from(text, "utf8");
  const z = zlib as unknown as ZstdCapable;
  if (codec === "zstd" && z.zstdCompressSync !== undefined) return z.zstdCompressSync(buf);
  return brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
}

export function decompress(data: Buffer, codec: Codec = preferredCodec()): string {
  const z = zlib as unknown as ZstdCapable;
  if (codec === "zstd" && z.zstdDecompressSync !== undefined) return z.zstdDecompressSync(data).toString("utf8");
  return brotliDecompressSync(data).toString("utf8");
}

/** Cache filename: `<fileVersion>.snapshot.json.<codec>` (docs/reference/spec.md section 4.9). */
export function cacheFileName(fileVersion: string, codec: Codec = preferredCodec()): string {
  return `${fileVersion}.snapshot.json.${codec}`;
}
