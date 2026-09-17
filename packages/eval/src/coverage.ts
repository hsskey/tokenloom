// Variant coverage is a separate metric from S1 and S2 (docs/reference/spec.md 9.5): a response that
// renders one of twenty variants scores S1 = 1 and S2 = 1 today, so neither can see a missing variant.
import { z } from "zod";
import { extractBlocks } from "./score";
import { variantMarkers } from "./html-markers";
import {
  expectedVariants, ExpectedVariantsError, resolveVariantMarker, type ExpectedTarget, type ExpectedVariants,
} from "./variant-reference";

const RECALL_DIGITS = 4;

export const Coverage = z.object({
  scope: z.enum(["component", "variant"]),
  expected: z.number(),
  actual: z.number(),
  matched: z.number(),
  variantRecall: z.number(),
  variantPrecision: z.number().nullable(),
  duplicates: z.number(),
  unresolved: z.number(),
  missing: z.array(z.string()),
  unexpected: z.array(z.string()),
});
export type CoverageT = z.infer<typeof Coverage>;

export const CoverageErrorCode = z.enum(["NO_HTML_BLOCK", "NO_OUTPUT", "EXPECTED_SET_UNRESOLVED", "DOM_DISAGREEMENT"]);
export type CoverageError = z.infer<typeof CoverageErrorCode>;

export interface CoverageResult {
  coverageStatus: "measured" | "error";
  coverage: CoverageT | null;
  coverageError?: CoverageError;
}

function coverageError(code: CoverageError): CoverageResult {
  return { coverageStatus: "error", coverage: null, coverageError: code };
}

function round(value: number): number {
  return Number(value.toFixed(RECALL_DIGITS));
}

// `DOM_DISAGREEMENT` is produced only by the S3 wiring, never here.
export function scoreCoverage(text: string, expected: ExpectedVariants): CoverageResult {
  if (text.trim() === "") return coverageError("NO_OUTPUT");
  const html = extractBlocks(text).html;
  if (html === null) return coverageError("NO_HTML_BLOCK");

  const resolved: string[] = [];
  const rejected: string[] = [];
  for (const marker of variantMarkers(html)) {
    const outcome = resolveVariantMarker(expected.context, marker);
    if (typeof outcome === "string") resolved.push(outcome);
    else rejected.push(`${outcome.code}:${outcome.raw}`);
  }

  const expectedSet = new Set(expected.selectors);
  const distinctResolved = new Set(resolved);
  const actualSet = new Set([...distinctResolved, ...rejected]);
  const matched = [...distinctResolved].filter((selector) => expectedSet.has(selector)).length;
  const actual = actualSet.size;
  const coverage: CoverageT = {
    scope: expected.scope,
    expected: expectedSet.size,
    actual,
    matched,
    variantRecall: expectedSet.size === 0 ? round(1) : round(matched / expectedSet.size),
    variantPrecision: actual === 0 ? null : round(matched / actual),
    duplicates: resolved.length - distinctResolved.size,
    unresolved: rejected.length,
    missing: [...expectedSet].filter((selector) => !distinctResolved.has(selector)).sort(),
    unexpected: [...actualSet].filter((selector) => !expectedSet.has(selector)).sort(),
  };
  return { coverageStatus: "measured", coverage };
}

export function runCoverage(repoRoot: string, target: ExpectedTarget, text: string): CoverageResult {
  let expected: ExpectedVariants;
  try {
    expected = expectedVariants(repoRoot, target);
  } catch (error) {
    if (error instanceof ExpectedVariantsError) return coverageError("EXPECTED_SET_UNRESOLVED");
    throw error;
  }
  return scoreCoverage(text, expected);
}
