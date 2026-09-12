// Synthetic-tree scaling from 1k to 10k nodes; docs/reference/verification.md section 7 owns the thresholds.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { Snapshot } from "@tokenloom/schema";
import { buildDesignContext } from "@tokenloom/parser";
import { synthSnapshot } from "@tokenloom/verify";
import { median, timed, type BenchRecord } from "./util";

const ROOT = resolve(import.meta.dirname, "..");

const HEAP_SAMPLES = 5;

/**
 * Without explicit GC, collection timing moves measured heap deltas by 2-3x (88-205 MB observed).
 * tsx does not expose the parent's flag in the script context, so enable it here. An unavailable gc
 * throws rather than reporting an uncollected heap that looks like a real regression.
 */
function exposeGc(): () => void {
  const existing = (globalThis as { gc?: () => void }).gc;
  if (existing !== undefined) return existing;
  setFlagsFromString("--expose-gc");
  const revived = runInNewContext("gc") as unknown;
  if (typeof revived !== "function") {
    throw new Error("scale bench: gc is unavailable, heap would be measured without collection");
  }
  return revived as () => void;
}

/** Runs GC twice because V8 collects objects released by the first pass on the second. */
function collect(gc: () => void): void {
  gc();
  gc();
}

/**
 * Takes the baseline before snapshot creation. A later baseline excludes retained snapshot memory and
 * measures only garbage, producing meaningless 78-205 MB swings. This measures heap retained while
 * processing 10k nodes.
 */
function measure(nodes: number, gc: () => void): { ms: number; heapMb: number; samples: string } {
  collect(gc);
  const before = process.memoryUsage().heapUsed;
  const snapshot = Snapshot.parse(synthSnapshot(nodes));
  const times = timed(1, 5, () => { buildDesignContext(snapshot, { name: "Synth" }); });
  // The minimum of repeated post-collection readings is the retained size; higher readings still hold garbage.
  const samples: number[] = [];
  for (let i = 0; i < HEAP_SAMPLES; i += 1) {
    collect(gc);
    samples.push(Number(Math.max(0, (process.memoryUsage().heapUsed - before) / (1024 * 1024)).toFixed(1)));
  }
  // Serialize samples to avoid widening the BenchRecord `number | string` index signature.
  return { ms: median(times), heapMb: Math.min(...samples), samples: samples.join(" ") };
}

export function measureScale(): BenchRecord {
  const gc = exposeGc();
  const small = measure(1_000, gc);
  const large = measure(10_000, gc);
  return {
    name: "scale",
    ms1k: small.ms,
    ms10k: large.ms,
    scale10x: Number((large.ms / Math.max(small.ms, 0.001)).toFixed(2)),
    // config.json bench.scaleHeapMb applies to the 10k case only.
    heapMb: large.heapMb,
    heapMb1k: small.heapMb,
    heapSamples: large.samples,
    heapSamples1k: small.samples,
  };
}

/**
 * Prior benchmark work in the same process expands the V8 heap and contaminates the baseline
 * (150 versus 213 MB observed), so scale measurement runs in a fresh process.
 */
export function run(): BenchRecord {
  const child = spawnSync(process.execPath, [
    "--expose-gc",
    resolve(ROOT, "node_modules/tsx/dist/cli.mjs"),
    resolve(ROOT, "bench/scale.child.ts"),
  ], { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const line = child.stdout.trim().split("\n").pop() ?? "";
  if (line === "") throw new Error(`scale bench child failed: ${child.stderr.slice(-400)}`);
  return JSON.parse(line) as BenchRecord;
}
