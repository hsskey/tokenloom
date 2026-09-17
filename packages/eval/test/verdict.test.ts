import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readThresholds, runVerdict, type VerdictInput } from "../src/stats";
import { loadTrajectoryMatrix } from "../src/trajectory";
import type { CoverageT } from "../src/coverage";

const repoRoot = resolve(import.meta.dirname, "../../..");
const thresholds = readThresholds(repoRoot);

function coverage(over: Partial<CoverageT>): CoverageT {
  return {
    scope: "component", expected: 2, actual: 2, matched: 2, variantRecall: 1, variantPrecision: 1,
    duplicates: 0, unresolved: 0, missing: [], unexpected: [], ...over,
  };
}

const verdict = (input: VerdictInput): ReturnType<typeof runVerdict> => runVerdict(input, thresholds);

describe("runVerdict conjunction (SPEC 9.5)", () => {
  it("keeps a legacy row without coverage out of a verdict as not-recorded and null overall", () => {
    expect(verdict({ s1: 0, s2: 1 })).toEqual({
      s1: "fail", s2: "pass", s3: "not-recorded", coverage: "not-recorded", overall: null,
    });
  });

  it("fails a coverage error row even before S3 is wired", () => {
    const result = verdict({ s1: 1, s2: 1, coverageStatus: "error" });

    expect(result.coverage).toBe("error");
    expect(result.overall).toBe(false);
  });

  it("fails a coverage-failing row even when S3 is unknown", () => {
    const result = verdict({ s1: 1, s2: 1, coverageStatus: "measured", coverage: coverage({ variantRecall: 0.5, matched: 1 }) });

    expect(result.coverage).toBe("fail");
    expect(result.overall).toBe(false);
  });

  it("fails an S3 error row even when coverage passes", () => {
    const result = verdict({ s1: 1, s2: 1, coverageStatus: "measured", coverage: coverage({}), s3Status: "error" });

    expect(result.coverage).toBe("pass");
    expect(result.s3).toBe("error");
    expect(result.overall).toBe(false);
  });

  it("passes overall only when every check is a pass or a true not-applicable", () => {
    const result = verdict({ s1: 1, s2: 1, coverageStatus: "measured", coverage: coverage({}), s3Status: "measured", s3: 0 });

    expect(result).toEqual({ s1: "pass", s2: "pass", s3: "pass", coverage: "pass", overall: true });
  });

  it("withholds an overall verdict as null while S3 is not recorded", () => {
    const result = verdict({ s1: 1, s2: 1, coverageStatus: "measured", coverage: coverage({}) });

    expect(result.coverage).toBe("pass");
    expect(result.overall).toBeNull();
  });
});

describe("trajectory variant validation at load (SPEC 9.5)", () => {
  function matrixWithVariant(variant: string): string {
    const source = readFileSync(resolve(repoRoot, "eval/trajectory.yaml"), "utf8");
    const patched = source.replace(
      "    variant: size=md,state=default",
      `    variant: "${variant}"`,
    );
    const path = join(mkdtempSync(join(tmpdir(), "tl-variant-")), "trajectory.yaml");
    writeFileSync(path, patched);
    return path;
  }

  it("fails an ambiguous variant with its selector code", () => {
    expect(() => loadTrajectoryMatrix(matrixWithVariant("size=md"), repoRoot)).toThrow(/VARIANT_AMBIGUOUS/);
  });

  it("fails an unknown variant key with its selector code", () => {
    expect(() => loadTrajectoryMatrix(matrixWithVariant("tone=loud"), repoRoot)).toThrow(/VARIANT_SELECTOR_INVALID/);
  });

  it("loads a matrix whose variant names exactly one variant", () => {
    expect(loadTrajectoryMatrix(matrixWithVariant("size=md,state=default"), repoRoot).tasks
      .find((task) => task.task === "variant-only")?.variant).toBe("size=md,state=default");
  });
});
