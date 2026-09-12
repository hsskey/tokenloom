// Warm latency, size, and compression ratio for compact design context.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Snapshot, stableJsonFile, stableStringify } from "@tokenloom/schema";
import { buildDesignContext } from "@tokenloom/parser";
import { median, percentile, timed, type BenchRecord } from "./util";

const ROOT = resolve(import.meta.dirname, "..");

function allSampleDirs(): string[] {
  const base = join(ROOT, "samples");
  return readdirSync(base).filter((n) => existsSync(join(base, n, "snapshot.json"))).sort();
}
/** Threshold population uses synthetic samples; real-file size depends on source data, not design budget. */
export function sampleDirs(): string[] {
  return allSampleDirs().filter((n) => !n.startsWith("real-"));
}

/** Real-file snapshots recorded for observation but excluded from verdicts (docs/reference/verification.md section 7). */
export function realSampleDirs(): string[] {
  return allSampleDirs().filter((n) => n.startsWith("real-"));
}

function loadSnapshot(dir: string): ReturnType<typeof Snapshot.parse> {
  return Snapshot.parse(JSON.parse(readFileSync(join(ROOT, "samples", dir, "snapshot.json"), "utf8")));
}

/**
 * Size breakdown for captured-file design context. Recorded in verify.json realSamples only; the
 * benchmark gate never judges it. The fields identify whether deltas, full roots, warnings, or annotations dominate size.
 */
export function realRecords(): BenchRecord[] {
  const out: BenchRecord[] = [];
  for (const dir of realSampleDirs()) {
    const snapshot = loadSnapshot(dir);
    const set = snapshot.componentSets[0];
    if (set === undefined) continue;
    const result = buildDesignContext(snapshot, { name: set.name, annotations: true });
    if (!result.ok) continue;
    const variants = result.context.component.variants;
    const bytes = (value: unknown): number => Buffer.byteLength(stableStringify(value), "utf8");
    out.push({
      name: `real.${dir}`,
      contextBytes: Buffer.byteLength(stableJsonFile(result.context), "utf8"),
      variants: variants.length,
      deltaBytes: variants.reduce((sum, v) => sum + bytes(v.delta ?? []), 0),
      rootVariants: variants.filter((v) => v.root !== undefined).length,
      warningBytes: bytes(result.context.warnings),
      annotationBytes: bytes(result.context.annotations),
    });
  }
  return out;
}

export function run(): BenchRecord {
  const times: number[] = [];
  const sizes: number[] = [];
  const ratios: number[] = [];
  for (const dir of sampleDirs()) {
    const snapshot = loadSnapshot(dir);
    const set = snapshot.componentSets[0];
    if (set === undefined) continue;
    const name = set.name;
    times.push(...timed(5, 30, () => { buildDesignContext(snapshot, { name, annotations: true }); }));
    const result = buildDesignContext(snapshot, { name, annotations: true });
    if (!result.ok) continue;
    const bytes = Buffer.byteLength(stableJsonFile(result.context), "utf8");
    sizes.push(bytes);
    // The ratio compares the target component set alone, not the whole snapshot, against its design context.
    ratios.push(Buffer.byteLength(stableStringify(set), "utf8") / bytes);
  }
  return {
    name: "context.compact",
    p50: percentile(times, 50),
    p99: percentile(times, 99),
    bytesP99: percentile(sizes, 99),
    ratioMedian: median(ratios),
    samples: sampleDirs().length,
  };
}
