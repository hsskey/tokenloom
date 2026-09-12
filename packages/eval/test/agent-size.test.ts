import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableJsonFile } from "@tokenloom/schema";
import {
  agentSizeOf, canonicalContextOf, referenceSamples, summarizeAgentSizes, type AgentSize,
} from "../src/agent-size";

const repoRoot = resolve(import.meta.dirname, "../../..");

/** The nine samples the P6 byte target is stated against. */
const POPULATION = [
  "absolute-card", "button", "four-modes", "icon-button", "korean-names",
  "nested-instance", "real-annotated-theme", "single-mode", "twenty-variants",
];

const size = (sample: string, canonicalBytes: number, agentBytes: number): AgentSize => ({
  sample,
  canonicalBytes,
  agentBytes,
  reductionPct: ((canonicalBytes - agentBytes) / canonicalBytes) * 100,
});

describe("Agent size population", () => {
  it("measures exactly the samples that carry a locked canonical reference", () => {
    expect(referenceSamples(repoRoot)).toEqual(POPULATION);
  });

  it.each(POPULATION)("%s canonical bytes are the locked reference bytes", (sample) => {
    const reference = readFileSync(resolve(repoRoot, "samples", sample, "reference/context.compact.json"), "utf8");

    const rebuilt = stableJsonFile(canonicalContextOf(repoRoot, sample));

    expect(rebuilt).toBe(reference);
  });
});

describe("Agent size measurement", () => {
  it("reports the button reference byte counts and their reduction", () => {
    const measured = agentSizeOf("button", canonicalContextOf(repoRoot, "button"));

    expect(measured).toMatchObject({ sample: "button", canonicalBytes: 2639, agentBytes: 2389 });
    expect(measured.reductionPct).toBeCloseTo(9.473285335354301, 12);
  });

  it("finds no sample whose Agent view is larger than its canonical context", () => {
    const summary = summarizeAgentSizes(
      referenceSamples(repoRoot).map((s) => agentSizeOf(s, canonicalContextOf(repoRoot, s))));

    expect(summary.expandedSamples).toBe(0);
    expect(summary.samples).toBe(POPULATION.length);
  });
});

describe("Agent size summary", () => {
  it("takes the median reduction of an odd population", () => {
    const summary = summarizeAgentSizes([size("a", 100, 97), size("b", 100, 90), size("c", 100, 95)]);

    expect(summary.bytesReductionMedian).toBe(5);
  });

  it("keeps a 3.999 percent median below the four-percent acceptance boundary", () => {
    const reductions = [1000, 2000, 3000, 3998, 3999, 5000, 6000, 7000, 8000]
      .map((removed, index) => size(String(index), 100_000, 100_000 - removed));

    expect(summarizeAgentSizes(reductions).bytesReductionMedian).toBeCloseTo(3.999, 12);
  });

  it("names the sample with the smallest reduction", () => {
    const summary = summarizeAgentSizes([size("a", 100, 90), size("b", 100, 97), size("c", 100, 95)]);

    expect(summary.minSample).toBe("b");
  });

  it("counts only the sample whose Agent view expanded, and names it", () => {
    const shrank = [size("a", 100, 90), size("b", 100, 95)];

    const summary = summarizeAgentSizes([...shrank, size("grew", 100, 110)]);

    expect(summary).toMatchObject({ expandedSamples: 1, minSample: "grew", bytesReductionMin: -10 });
  });

  it("preserves a one-byte expansion instead of rounding it to zero", () => {
    const summary = summarizeAgentSizes([size("grew", 100_000, 100_001)]);

    expect(summary.expandedSamples).toBe(1);
    expect(summary.bytesReductionMedian).toBeCloseTo(-0.001, 12);
    expect(summary.bytesReductionMin).toBeCloseTo(-0.001, 12);
  });

  it("reports a zero median for an empty population so the gate cannot pass on nothing", () => {
    const summary = summarizeAgentSizes([]);

    expect(summary).toEqual({
      bytesReductionMedian: 0, bytesReductionMin: 0, expandedSamples: 0, minSample: "", samples: 0,
    });
  });
});
