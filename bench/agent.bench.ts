// Warm latency of the Agent projection and its size against canonical design context.
// docs/reference/verification.md section 7 owns the thresholds this record feeds.
import { resolve } from "node:path";
import { projectAgentContext } from "@tokenloom/parser";
import { agentSizeOf, canonicalContextOf, referenceSamples, summarizeAgentSizes } from "@tokenloom/eval";
import { rawPercentile, timed, type BenchRecord } from "./util";

const ROOT = resolve(import.meta.dirname, "..");

/** Reading a field of every projection keeps the optimizer from removing the call being measured. */
let consumed = 0;

export function run(): BenchRecord {
  const built = referenceSamples(ROOT).map((sample) => ({ sample, context: canonicalContextOf(ROOT, sample) }));
  const times: number[] = [];
  for (const { context } of built) {
    // Projection only, on an already-built canonical context, as the P6 measurement method requires.
    times.push(...timed(5, 30, () => { consumed += projectAgentContext(context).component.name.length; }));
  }
  if (consumed === 0) throw new Error("agent bench: no projection was measured");
  return {
    name: "context.agent",
    p50: rawPercentile(times, 50),
    p99: rawPercentile(times, 99),
    ...summarizeAgentSizes(built.map(({ sample, context }) => agentSizeOf(sample, context))),
  };
}
