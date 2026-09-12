import { describe, expect, it } from "vitest";
import type { DesignContextT, DesignNodeT } from "@tokenloom/schema";
import {
  contextBytes, fullContext, run, summarizeVariantSizes, variantSizeOf, variantSizes, type VariantSize,
} from "../../../bench/variant.bench";

/** The target docs/goals.md states for `twenty-variants`. */
const FULL_BYTES = 7602;
const GOAL_MEDIAN_PCT = 56.52459878979216;
const NON_BASE_VARIANTS = 19;

const size = (selector: string, fullBytes: number, variantBytes: number): VariantSize => ({
  selector,
  fullBytes,
  variantBytes,
  reductionPct: ((fullBytes - variantBytes) / fullBytes) * 100,
});

const root: DesignNodeT = {
  id: "1:1", role: "container", name: "Chip",
  layout: { dir: "row", sizing: { w: "hug", h: "hug" } },
  style: {}, children: [],
};

/** Contexts whose only difference is the variant list, which is what selection produces. */
const context = (variants: DesignContextT["component"]["variants"]): DesignContextT => ({
  version: 1,
  source: { fileKey: "K", nodeId: "n", fileVersion: "v", fetchedAt: "2026-01-01T00:00:00Z", contentHash: "h" },
  component: {
    name: "Chip", block: "chip", props: { size: ["sm", "md"] },
    base: { props: { size: "sm" }, root },
    variants,
  },
  tokensUsed: [],
  annotations: [],
  warnings: [],
});

const variantOf = (value: string): DesignContextT["component"]["variants"][number] => ({
  props: { size: value }, delta: [{ path: "/name", value }],
});

describe("Variant size measurement", () => {
  it("reports both byte counts and a positive reduction when the selection is smaller", () => {
    const measured = variantSizeOf(
      "size=md", context([variantOf("md"), variantOf("lg")]), context([variantOf("md")]));

    expect(measured).toMatchObject({ selector: "size=md", fullBytes: 1085, variantBytes: 907 });
    expect(measured.reductionPct).toBeCloseTo(16.40552995391705, 12);
  });

  it("reports a negative reduction when the selection is larger, so the sign carries meaning", () => {
    const measured = variantSizeOf(
      "size=md", context([variantOf("md")]), context([variantOf("md"), variantOf("lg"), variantOf("xl")]));

    expect(measured.reductionPct).toBeCloseTo(-39.250275633958104, 12);
  });

  it("measures the same context as a reduction of zero rather than a missing value", () => {
    const full = context([variantOf("md")]);

    expect(variantSizeOf("size=md", full, full).reductionPct).toBe(0);
  });
});

describe("Variant size summary", () => {
  it("takes the median reduction of an odd population", () => {
    // Byte counts chosen so each reduction is exact in binary and the median needs no tolerance.
    const summary = summarizeVariantSizes([size("a", 800, 400), size("b", 800, 200), size("c", 800, 600)]);

    expect(summary.bytesReductionMedian).toBe(50);
  });

  it("keeps a 44.999 percent median below the forty-five percent acceptance boundary", () => {
    const reductions = [44000, 44500, 44900, 44995, 44999, 45001, 45100, 45500, 46000]
      .map((removed, index) => size(String(index), 100_000, 100_000 - removed));

    expect(summarizeVariantSizes(reductions).bytesReductionMedian).toBeCloseTo(44.999, 12);
  });

  it("names the variant with the smallest reduction", () => {
    const summary = summarizeVariantSizes([size("a", 100, 40), size("b", 100, 48), size("c", 100, 45)]);

    expect(summary.minVariant).toBe("b");
  });

  it("preserves a one-byte expansion as a negative reduction instead of rounding it to zero", () => {
    const summary = summarizeVariantSizes([size("grew", 100_000, 100_001)]);

    expect(summary.bytesReductionMedian).toBeCloseTo(-0.001, 12);
    expect(summary.bytesReductionMin).toBeCloseTo(-0.001, 12);
  });

  it("reports a zero median for an empty population so the gate cannot pass on nothing", () => {
    expect(summarizeVariantSizes([])).toEqual({
      bytesReductionMedian: 0, bytesReductionMin: 0, minVariant: "", variants: 0,
    });
  });
});

describe("twenty-variants population", () => {
  it("rebuilds the canonical context at its locked reference size", () => {
    expect(contextBytes(fullContext())).toBe(FULL_BYTES);
  });

  it("measures one selection per non-base variant", () => {
    const sizes = variantSizes(fullContext());

    expect(sizes).toHaveLength(NON_BASE_VARIANTS);
  });

  it("reproduces the reduction median docs/goals.md states for this sample", () => {
    const summary = summarizeVariantSizes(variantSizes(fullContext()));

    expect(summary.bytesReductionMedian).toBeCloseTo(GOAL_MEDIAN_PCT, 12);
  });

  it("finds no variant selection that expands the canonical context", () => {
    const summary = summarizeVariantSizes(variantSizes(fullContext()));

    expect(summary.bytesReductionMin).toBeGreaterThan(0);
  });

  it("records the full context bytes, not the bytes of a selected context", () => {
    expect(run().fullBytes).toBe(FULL_BYTES);
  });

  it("emits every field the benchmark record contract names", () => {
    expect(Object.keys(run()).sort()).toEqual([
      "bytesReductionMedian", "bytesReductionMin", "fullBytes", "minVariant", "name", "p50", "p99", "variants",
    ]);
  });
});
