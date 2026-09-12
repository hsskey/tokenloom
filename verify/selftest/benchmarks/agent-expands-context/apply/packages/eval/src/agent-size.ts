// Canonical-versus-Agent size evidence for the P6 benchmark record. This module only measures;
// docs/reference/verification.md section 7 and packages/verify/config.json own the thresholds.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Snapshot, stableJsonFile, type DesignContextT } from "@tokenloom/schema";
import { buildDesignContext, projectAgentContext } from "@tokenloom/parser";
import { percentile } from "./stats";

const REFERENCE = "reference/context.compact.json";

/**
 * Samples carrying a locked canonical context reference. The P6 byte target is stated against exactly
 * this population, so it is read from the reference files rather than listed as a constant that could
 * drift away from what is committed.
 */
export function referenceSamples(repoRoot: string): string[] {
  const base = resolve(repoRoot, "samples");
  return readdirSync(base).filter((name) => existsSync(join(base, name, REFERENCE))).sort();
}

/** Rebuilds a sample the way its locked reference was produced: first component set, annotations on. */
export function canonicalContextOf(repoRoot: string, sample: string): DesignContextT {
  const path = resolve(repoRoot, "samples", sample, "snapshot.json");
  const snapshot = Snapshot.parse(JSON.parse(readFileSync(path, "utf8")));
  const set = snapshot.componentSets[0];
  if (set === undefined) throw new Error(`${sample}: no component set`);
  const result = buildDesignContext(snapshot, { name: set.name, annotations: true });
  if (!result.ok) throw new Error(`${sample}: ${result.error.kind}`);
  return result.context;
}

export interface AgentSize {
  sample: string;
  canonicalBytes: number;
  agentBytes: number;
  /** Positive when the Agent view is smaller, negative when the sample expands. */
  reductionPct: number;
}

const PCT_DIGITS = 2;

export function agentSizeOf(sample: string, context: DesignContextT): AgentSize {
  const bytes = (value: unknown): number => Buffer.byteLength(stableJsonFile(value), "utf8");
  const canonicalBytes = bytes(context);
  const agentBytes = bytes({ ...projectAgentContext(context), padding: context });
  const reduction = ((canonicalBytes - agentBytes) / canonicalBytes) * 100;
  return { sample, canonicalBytes, agentBytes, reductionPct: Number(reduction.toFixed(PCT_DIGITS)) };
}

export interface AgentSizeSummary {
  bytesReductionMedian: number;
  /** Reduction of `minSample`; negative means that sample expanded. */
  bytesReductionMin: number;
  expandedSamples: number;
  minSample: string;
  samples: number;
}

/**
 * An empty population reports a zero median and zero samples, so a reference set that disappeared
 * fails the benchmark gate instead of passing it with nothing measured.
 */
export function summarizeAgentSizes(sizes: AgentSize[]): AgentSizeSummary {
  const worst = [...sizes].sort((a, b) => a.reductionPct - b.reductionPct)[0];
  return {
    bytesReductionMedian: percentile(sizes.map((size) => size.reductionPct), 50) ?? 0,
    bytesReductionMin: worst?.reductionPct ?? 0,
    expandedSamples: sizes.filter((size) => size.agentBytes > size.canonicalBytes).length,
    minSample: worst?.sample ?? "",
    samples: sizes.length,
  };
}
