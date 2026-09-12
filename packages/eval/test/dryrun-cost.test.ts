import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  costBasis, dryRun, loadMatrix, promptHash, readPlanning, readPricing, readTrackedRuns, templateText,
  type EvalRun,
} from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const rate = readPricing(repoRoot)?.models.opus;
const hashNow = (): string => promptHash(templateText(repoRoot));

/** Scripted baseline row containing only fields used by these tests. */
function runRow(target: string, extra: Partial<EvalRun> = {}): EvalRun {
  return {
    cmd: "eval", target, utcDate: "2026-09-03", sampleName: target.split("/")[0] ?? "", inputVariant: "raw",
    input: "snapshot", repeat: 0, adapter: "claude", model: "opus", invocation: "claude -p",
    promptHash: "h1", bytesIn: 0, bytesOut: 0, ratio: 0, estTokens: 0, inputTokens: 0,
    cacheCreation: 0, cacheRead: 0, outputTokens: 300, costUsd: 0, ms: {}, warnings: 0, ...extra,
  };
}

/** Stores scripted rows in a temporary repository and reads them back as a baseline. */
function basisOf(records: EvalRun[]): EvalRun[] {
  const root = mkdtempSync(join(tmpdir(), "tl-cost-"));
  mkdirSync(join(root, "runs"), { recursive: true });
  writeFileSync(join(root, "runs", "2026-01-01.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return readTrackedRuns(root);
}

/** Single-combination matrix whose `repeats` value exposes repeated-row pricing. */
function oneCombo(repeats: number): ReturnType<typeof loadMatrix> {
  const dir = mkdtempSync(join(tmpdir(), "tl-cost-matrix-"));
  const path = join(dir, "m.yaml");
  writeFileSync(path, [
    "samples: [button]", "inputs: [snapshot]", "inputVariants: [compact]", "platforms: [css]",
    `repeats: ${repeats}`, "maxInputTokens: 150000", "model: opus",
  ].join("\n"), "utf8");
  return loadMatrix(path, repoRoot);
}

/** These points define a line with slope 1 and intercept 3,000. */
const TWO_WRITES = [
  runRow("a/raw", { estTokens: 1000, cacheCreation: 4000, cacheRead: 12000 }),
  runRow("b/raw", { estTokens: 2000, cacheCreation: 5000, cacheRead: 10000 }),
];

describe("cost baseline (SPEC 9.6)", () => {
  it("returns least-squares coefficients and cacheRead p50 from cache-write rows", () => {
    const basis = costBasis(basisOf(TWO_WRITES), "opus", "h1");

    expect(basis).toEqual({ promptHash: "h1", lines: 2, ratio: 1, overhead: 3000, cacheReadPerCall: 10000 });
  });

  it("excludes skipped rows and rows without cache creation", () => {
    const noisy = [
      ...TWO_WRITES,
      runRow("c/raw", { estTokens: 9000, cacheCreation: 0, cacheRead: 90000 }),
      runRow("d/raw", { estTokens: 9000, cacheCreation: 90000, cacheRead: 90000, skipped: "MAX_INPUT_TOKENS" }),
    ];

    const basis = costBasis(basisOf(noisy), "opus", "h1");

    expect(basis).toEqual({ promptHash: "h1", lines: 2, ratio: 1, overhead: 3000, cacheReadPerCall: 10000 });
  });

  it("falls back to model-matched rows and reports a null hash when no hash matches", () => {
    const basis = costBasis(basisOf(TWO_WRITES), "opus", "unmatched-hash");

    expect(basis).toEqual({ promptHash: null, lines: 2, ratio: 1, overhead: 3000, cacheReadPerCall: 10000 });
  });

  it("returns null coefficients when one cache-write row cannot identify a line", () => {
    const basis = costBasis(basisOf([TWO_WRITES[0] as EvalRun]), "opus", "h1");

    expect(basis).toEqual({ promptHash: "h1", lines: 1, ratio: null, overhead: null, cacheReadPerCall: 12000 });
  });
});

describe("dry-run input cost (SPEC 9.6)", () => {
  it("keeps the input-token total but returns null cost when coefficients are unavailable", () => {
    const basisRuns = basisOf([runRow("a/raw", { promptHash: hashNow(), estTokens: 1000, cacheCreation: 4000 })]);

    const summary = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });

    expect({ cost: summary.estCostUsd, total: summary.estTotalCostUsd }).toEqual({ cost: null, total: null });
    expect(summary.estInputTokens).toBeGreaterThan(0);
  });

  it("prices the first prompt as a cache write and the per-call prefix as a cache read", () => {
    const basisRuns = basisOf(TWO_WRITES.map((r) => ({ ...r, promptHash: hashNow() })));

    const summary = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });

    // A slope of 1 and intercept of 3,000 makes prompt tokens estTokens + 3,000.
    const prompt = summary.estInputTokens + 3000;
    const expected = (prompt * (rate?.cacheWrite1hPerMTok ?? 0) + 10000 * (rate?.cacheReadPerMTok ?? 0)) / 1_000_000;
    expect(summary.estCostUsd).toBe(Number(expected.toFixed(4)));
  });

  it("prices a repeated prompt and prefix as cache reads instead of another write", () => {
    const basisRuns = basisOf(TWO_WRITES.map((r) => ({ ...r, promptHash: hashNow() })));
    const once = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });
    const prompt = once.estInputTokens + 3000;
    const write = prompt * (rate?.cacheWrite1hPerMTok ?? 0) + 10000 * (rate?.cacheReadPerMTok ?? 0);
    const read = (prompt + 10000) * (rate?.cacheReadPerMTok ?? 0);

    const twice = dryRun({ repoRoot, matrix: oneCombo(2), parallel: 1, basisRuns });

    expect(twice.estCostUsd).toBe(Number(((write + read) / 1_000_000).toFixed(4)));
    // Two rows costing less than twice one row proves that the repeat is not another write.
    expect(twice.estCostUsd).toBeLessThan((once.estCostUsd ?? 0) * 2);
  });

  it("includes costBasis so the priced rows remain traceable", () => {
    const basisRuns = basisOf(TWO_WRITES.map((r) => ({ ...r, promptHash: hashNow() })));

    const summary = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });

    expect(summary.costBasis)
      .toEqual({ promptHash: summary.promptHash, lines: 2, ratio: 1, overhead: 3000, cacheReadPerCall: 10000 });
  });
});

describe("recommended budget (SPEC 9.6)", () => {
  it("multiplies the estimate by planning headroom and includes that basis", () => {
    const basisRuns = basisOf(TWO_WRITES.map((r) => ({ ...r, promptHash: hashNow() })));
    const planning = readPlanning(repoRoot)?.budget;

    const summary = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });

    expect(summary.recommendedBudgetUsd)
      .toBe(Number(((summary.estTotalCostUsd ?? 0) * (planning?.factor ?? 0)).toFixed(4)));
    expect(summary.planningBasis).toEqual(planning);
  });

  it("applies headroom only to the recommendation while the estimate remains input plus output", () => {
    const basisRuns = basisOf(TWO_WRITES.map((r) => ({ ...r, promptHash: hashNow() })));

    const summary = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });

    expect(summary.estTotalCostUsd)
      .toBe(Number(((summary.estCostUsd ?? 0) + (summary.estOutputCostUsd ?? 0)).toFixed(4)));
    expect(summary.recommendedBudgetUsd ?? 0).toBeGreaterThan(summary.estTotalCostUsd ?? 0);
  });

  it("returns a null recommendation when the estimate is null", () => {
    const basisRuns = basisOf([runRow("a/raw", { promptHash: hashNow(), estTokens: 1000, cacheCreation: 4000 })]);

    const summary = dryRun({ repoRoot, matrix: oneCombo(1), parallel: 1, basisRuns });

    expect({ total: summary.estTotalCostUsd, budget: summary.recommendedBudgetUsd })
      .toEqual({ total: null, budget: null });
  });

  it("reads planning headroom with its reason and decision date", () => {
    const planning = readPlanning(repoRoot);

    expect(planning?.budget.factor).toBeGreaterThan(1);
    expect(planning?.budget.reason.length).toBeGreaterThan(0);
    expect(planning?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
