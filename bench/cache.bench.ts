// Decompression and parse latency for a 50 MB synthetic snapshot; docs/reference/verification.md section 7 owns the threshold.
import { compress, decompress, preferredCodec } from "@tokenloom/cache";
import { synthSnapshot } from "@tokenloom/verify";
import { median, timed, type BenchRecord } from "./util";

const TARGET_BYTES = 50 * 1024 * 1024;

/** Varies node counts per chunk; repeating one chunk compresses to 30 KB and makes decompression look unrealistically cheap. */
function buildPayload(): string {
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; total < TARGET_BYTES; i += 1) {
    const unit = JSON.stringify(synthSnapshot(1_900 + (i % 128)));
    parts.push(unit);
    total += unit.length + 1;
  }
  return `[${parts.join(",")}]`;
}

export function run(): BenchRecord {
  const codec = preferredCodec();
  const text = buildPayload();
  const packed = compress(text, codec);
  let parsed: unknown = null;
  const times = timed(1, 5, () => { parsed = JSON.parse(decompress(packed, codec)); });
  return {
    name: "cache",
    codec,
    ms: median(times),
    rawMb: Number((text.length / (1024 * 1024)).toFixed(1)),
    packedMb: Number((packed.length / (1024 * 1024)).toFixed(2)),
    ok: Array.isArray(parsed) ? 1 : 0,
  };
}
