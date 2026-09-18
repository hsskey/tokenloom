import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPromptInput, InputVariant, loadTrajectoryMatrix, renderTrajectoryReport, summarizeTrajectory,
  trajectoryPartitions, trajectoryTotalCost, type CoverageT, type TrajectoryRun,
} from "../src/index";

const root = resolve(import.meta.dirname, "../../..");
const TRAJECTORY_MATRIX = resolve(root, "eval/trajectory.yaml");
const TASKS = ["known-component", "unknown-component", "variant-only", "recovery"] as const;
const CONDITIONS = ["cli-canonical", "cli-agent", "mcp-agent"] as const;

function record(over: Partial<TrajectoryRun>): TrajectoryRun {
  return {
    cmd: "trajectory", utcDate: "2026-09-07", task: "known-component", condition: "cli-agent", repeat: 0,
    adapter: "claude", model: "opus", invocation: "claude", success: true, turns: 2, durationMs: 10,
    inputTokens: 100, cacheCreation: 200, cacheRead: 10844, outputTokens: 900, costUsd: 0.11,
    s1: 1, s2: 0.97, artifact: null, promptHash: "aaaaaaaaaaaa", toolCalls: [], recovery: [], ...over,
  };
}

/** The required 4 x 3 x 2 real set; `over` lets a case fail or mark specific cells. */
function completeSet(over: (task: string, condition: string, repeat: number) => Partial<TrajectoryRun> = () => ({})): TrajectoryRun[] {
  return TASKS.flatMap((task) => CONDITIONS.flatMap((condition) =>
    [0, 1].map((repeat) => record({ task, condition, repeat, ...over(task, condition, repeat) }))));
}

const coverage = (variantRecall: number): CoverageT => ({
  scope: "variant", expected: 1, actual: 1, matched: 1, variantRecall, variantPrecision: 1,
  duplicates: 0, unresolved: 0, missing: [], unexpected: [],
});

/** The line of a table headed by `heading` that begins with `prefix`. */
const rowStartingWith = (report: string, heading: string, prefix: string): string | undefined =>
  (report.split(heading)[1] ?? "").split("\n").find((line) => line.startsWith(prefix));

describe("Trajectory report rules from docs/reference/spec.md section 4.12", () => {
  it("A10: prints each task x condition cell as a raw success count, never a percentage", () => {
    const report = renderTrajectoryReport(completeSet());

    expect(report).toContain("### Task success by condition (raw counts)");
    expect(report).toContain("| known-component | 2/2 | 2/2 | 2/2 |");
    expect(report).toContain("| All tasks | 8/8 | 8/8 | 8/8 |");
    expect(report).not.toMatch(/Success rate/);
  });

  it("A10: a failed run lowers the raw count of its own cell only", () => {
    const runs = completeSet((task, condition, repeat) =>
      task === "known-component" && condition === "cli-canonical" && repeat === 0 ? { success: false } : {});

    expect(renderTrajectoryReport(runs)).toContain("| known-component | 1/2 | 2/2 | 2/2 |");
  });

  it("A10: a task a condition never ran prints '-' and marks the condition incomplete with no success rate", () => {
    const runs = completeSet().filter((r) => !(r.condition === "mcp-agent" && r.task === "recovery"))
      .filter((r) => !(r.condition === "cli-agent" && r.task === "recovery" && r.repeat === 1));
    const report = renderTrajectoryReport(runs);

    expect(report).toContain("| recovery | 2/2 | 1/1 short | - |");
    expect(report).toContain("| All tasks | 8/8 | incomplete | incomplete |");
    expect(report).not.toMatch(/Success rate/);
  });

  it("A10: an incomparable run is excluded from the cell count, flagged in the cell, and counted in diagnostics", () => {
    const runs = completeSet((task, condition, repeat) =>
      task === "known-component" && condition === "cli-agent" && repeat === 0
        ? { incomparable: true, error: "MISSING_AUTHORITATIVE_USAGE" } : {});
    const report = renderTrajectoryReport(runs);

    expect(report).toContain("| known-component | 2/2 | 1/1 (+1 incomparable) | 2/2 |");
    expect(rowStartingWith(report, "### Per-condition diagnostics", "| cli-agent |")
      ?.startsWith("| cli-agent | yes | 7 | 1 | 0 |")).toBe(true);
  });

  it("A10: fake rows never reach a printed number", () => {
    const runs = [...completeSet(), record({ adapter: "fake", inputTokens: 999_999, costUsd: 0 })];

    expect(renderTrajectoryReport(runs)).not.toContain("999999");
  });

  it("A10: the diagnostics medians equal the values recomputed from the run records", () => {
    const runs = completeSet((task, condition) => condition === "cli-canonical" ? { inputTokens: 500 } : {});
    const partition = trajectoryPartitions(runs)[0];
    if (partition === undefined) throw new Error("expected one partition");
    const summary = summarizeTrajectory(runs, partition).find((s) => s.condition === "cli-canonical");

    // totalInput = 500 + 200 + 10844 for every cli-canonical row.
    expect(summary?.inputTokensP50).toBe(11_544);
    expect(renderTrajectoryReport(runs)).toContain("| cli-canonical | yes | 8 | 0 | 0 | 11544 |");
  });

  it("A10: rows differing in prompt, requested model, resolved model, or invocation get separate sections", () => {
    const runs = [
      record({ resolvedModel: "claude-opus-5" }),
      record({ promptHash: "bbbbbbbbbbbb", resolvedModel: "claude-opus-5" }),
      record({ requestedModel: "sonnet", resolvedModel: "claude-sonnet-5" }),
      record({ resolvedModel: "claude-opus-6" }),
      record({ invocation: "claude --new", resolvedModel: "claude-opus-5" }),
    ];
    const report = renderTrajectoryReport(runs);

    expect(trajectoryPartitions(runs)).toHaveLength(5);
    expect(report).toContain("## prompt aaaaaaaaaaaa / model opus / resolved claude-opus-5 / invocation claude");
    expect(report).toContain("## prompt aaaaaaaaaaaa / model sonnet / resolved claude-sonnet-5 / invocation claude");
    expect(report).toContain("## prompt aaaaaaaaaaaa / model opus / resolved claude-opus-6 / invocation claude");
  });

  it("A10: a legacy row without resolvedModel never shares a section with a resolved-value row", () => {
    const runs = [record({}), record({ resolvedModel: "claude-opus-5" })];

    expect(trajectoryPartitions(runs)).toHaveLength(2);
    const report = renderTrajectoryReport(runs);
    expect(report).toContain("## prompt aaaaaaaaaaaa / model opus / resolved n/a / invocation claude");
    expect(report).toContain("## prompt aaaaaaaaaaaa / model opus / resolved claude-opus-5 / invocation claude");
  });

  it("A10: legacy rows without coverage or S3 print n/a and are never promoted to a passing measurement", () => {
    const report = renderTrajectoryReport(completeSet());

    expect(rowStartingWith(report, "### Per-condition diagnostics", "| cli-canonical |")?.endsWith("| n/a | n/a |")).toBe(true);
  });

  it("A10: coverage and S3 measurements appear in their own diagnostics columns", () => {
    const runs = completeSet(() => ({ coverageStatus: "measured", coverage: coverage(1), s3Status: "measured", s3: 0.02 }));
    const report = renderTrajectoryReport(runs);

    expect(rowStartingWith(report, "### Per-condition diagnostics", "| cli-canonical |")?.endsWith("| 1.00 | 0.02 |")).toBe(true);
  });

  it("A10: Total real cost sums every real run and an empty record set prints no measurement", () => {
    const runs = completeSet();
    const total = trajectoryTotalCost(runs) ?? 0;

    expect(renderTrajectoryReport(runs)).toContain(`Total real cost: ${total.toFixed(2)}`);
    expect(renderTrajectoryReport([])).toContain("no trajectory run records");
  });
});

/**
 * A11 governed the alternate format and short delta path experiments, and both concluded without adoption:
 * docs/reference/spec.md 4.13 rejected the delta path and 4.14 the alternate format, whose encoder is gone.
 * What remains is the default contract those experiments left unchanged, so these cases pin it by value.
 */
describe("Alternate representation rules from docs/reference/spec.md section 4.12", () => {
  it("A11: the publicly adopted evaluation representations are exactly the four recorded ones", () => {
    expect(InputVariant.options).toEqual(["raw", "compact", "compact+annotations", "agent"]);
    expect(loadTrajectoryMatrix(TRAJECTORY_MATRIX).conditions)
      .toEqual(["cli-canonical", "cli-agent", "mcp-agent"]);
  });

  it("A11: the rejected cli-agent-compact condition gets no primary column and stays a diagnostics-only record", () => {
    const runs = [...completeSet(),
      ...TASKS.flatMap((task) => [0, 1].map((repeat) => record({ condition: "cli-agent-compact", task, repeat })))];
    const report = renderTrajectoryReport(runs);

    expect(report.split("### Per-condition diagnostics")[0]).not.toContain("cli-agent-compact");
    expect(report).toContain("| cli-agent-compact | no |");
  });

  it("A11: the agent view an evaluation sends is still JSON, so no alternate encoding has been adopted", () => {
    const input = buildPromptInput(root, "button", "agent");

    expect(JSON.parse(input.context)).toHaveProperty("component.block", "button");
    expect(input.context.startsWith("{")).toBe(true);
  });
});
