// Canonical-versus-selected-Variant size and selection latency on `twenty-variants`.
// docs/reference/verification.md section 12.7 owns the thresholds this record feeds.
// Package sources are imported by path rather than by `@tokenloom/*` specifier: this module is
// consumed by a test outside the workspace packages, and the repository root has no workspace
// link for those names. `tsconfig.base.json` maps the specifiers to these same files.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Snapshot, stableJsonFile, type DesignContextT } from "../packages/schema/src/index";
import { buildDesignContext, selectVariant, variantSelectorOf } from "../packages/parser/src/index";
import { rawPercentile, timed, type BenchRecord } from "./util";

const ROOT = resolve(import.meta.dirname, "..");

/** The sample the 45 percent target is stated against (docs/goals.md). */
const SAMPLE = "twenty-variants";

export interface VariantSize {
  selector: string;
  fullBytes: number;
  variantBytes: number;
  /** Positive when the selected output is smaller, negative when it expands. */
  reductionPct: number;
}

/**
 * Both sides are serialized in the canonical view. Measuring an Agent-view numerator against a
 * canonical denominator would count the P6 projection saving a second time.
 */
export function contextBytes(context: DesignContextT): number {
  return Buffer.byteLength(stableJsonFile(context), "utf8");
}

export function variantSizeOf(selector: string, full: DesignContextT, selected: DesignContextT): VariantSize {
  const fullBytes = contextBytes(full);
  const variantBytes = contextBytes(selected);
  return { selector, fullBytes, variantBytes, reductionPct: ((fullBytes - variantBytes) / fullBytes) * 100 };
}

export interface VariantSizeSummary {
  bytesReductionMedian: number;
  /** Reduction of `minVariant`; negative means that selection expanded the output. */
  bytesReductionMin: number;
  minVariant: string;
  variants: number;
}

/**
 * An empty population reports a zero median and zero variants, so a sample that lost its variants
 * fails the benchmark gate instead of passing it with nothing measured.
 */
export function summarizeVariantSizes(sizes: VariantSize[]): VariantSizeSummary {
  const worst = [...sizes].sort((a, b) => a.reductionPct - b.reductionPct)[0];
  return {
    bytesReductionMedian: rawPercentile(sizes.map((size) => size.reductionPct), 50),
    bytesReductionMin: worst?.reductionPct ?? 0,
    minVariant: worst?.selector ?? "",
    variants: sizes.length,
  };
}

/** Rebuilds the sample the way its locked reference was produced: first component set, annotations on. */
export function fullContext(): DesignContextT {
  const path = join(ROOT, "samples", SAMPLE, "snapshot.json");
  const snapshot = Snapshot.parse(JSON.parse(readFileSync(path, "utf8")));
  const set = snapshot.componentSets[0];
  if (set === undefined) throw new Error(`${SAMPLE}: no component set`);
  const built = buildDesignContext(snapshot, { name: set.name, annotations: true });
  if (!built.ok) throw new Error(`${SAMPLE}: ${built.error.kind}`);
  return built.context;
}

/** One selector per non-base variant, which is the population the 45 percent median is stated over. */
export function variantSizes(full: DesignContextT): VariantSize[] {
  return full.component.variants.map((variant) => {
    const selector = variantSelectorOf(variant.props);
    const selected = selectVariant(full, selector);
    if (!selected.ok) throw new Error(`${SAMPLE}: ${selector} is ${selected.failure.code}`);
    return variantSizeOf(selector, full, selected.context);
  });
}

/** Reading a field of every selection keeps the optimizer from removing the call being measured. */
let consumed = 0;

export function run(): BenchRecord {
  const full = fullContext();
  const sizes = variantSizes(full);
  const times: number[] = [];
  for (const { selector } of sizes) {
    // Selection only, on an already-built canonical context, as the design note's post-filter decision requires.
    times.push(...timed(5, 30, () => { consumed += selectVariant(full, selector).ok ? 1 : 0; }));
  }
  if (consumed === 0) throw new Error("variant bench: no selection was measured");
  return {
    name: "context.variant",
    p50: rawPercentile(times, 50),
    p99: rawPercentile(times, 99),
    fullBytes: contextBytes(full),
    ...summarizeVariantSizes(sizes),
  };
}
