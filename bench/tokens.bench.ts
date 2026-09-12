// `tokens build` latency; docs/reference/verification.md section 7 owns the threshold.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Snapshot } from "@tokenloom/schema";
import { buildTokens } from "@tokenloom/tokens";
import { percentile, timed, type BenchRecord } from "./util";
import { sampleDirs } from "./context.bench";

const ROOT = resolve(import.meta.dirname, "..");

export function run(): BenchRecord {
  const times: number[] = [];
  for (const dir of sampleDirs()) {
    const snapshot = Snapshot.parse(JSON.parse(readFileSync(join(ROOT, "samples", dir, "snapshot.json"), "utf8")));
    // The CLI emits all three platforms in one invocation, so the benchmark measures that whole surface.
    times.push(...timed(2, 10, () => { buildTokens(snapshot, ["css", "swift", "kotlin"]); }));
  }
  return { name: "tokens.build", p50: percentile(times, 50), p99: percentile(times, 99) };
}
