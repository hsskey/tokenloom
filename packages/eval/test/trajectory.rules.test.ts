import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPromptInput, InputVariant, loadTrajectoryMatrix, percentile, renderTrajectoryReport, summarizeTrajectory,
  totalInput, trajectoryPartitions, trajectoryTotalCost, type TrajectoryRun,
} from "../src/index";

const root = resolve(import.meta.dirname, "../../..");
const TRAJECTORY_MATRIX = resolve(root, "eval/trajectory.yaml");
const MEDIAN = 50;

function record(over: Partial<TrajectoryRun>): TrajectoryRun {
  return {
    cmd: "trajectory", utcDate: "2026-09-07", task: "known-component", condition: "cli-agent", repeat: 0,
    adapter: "claude", model: "opus", invocation: "claude", success: true, turns: 2, durationMs: 10,
    inputTokens: 100, cacheCreation: 200, cacheRead: 10844, outputTokens: 900, costUsd: 0.11,
    s1: 1, s2: 0.97, artifact: null, promptHash: "aaaaaaaaaaaa", toolCalls: [], recovery: [], ...over,
  };
}

const CALL = { turn: 0, tool: "context", args: [], exitCode: 0, bytes: 10 };
const RECOVERY = { turn: 0, code: "COMPONENT_NOT_FOUND", resolved: true };
const RUNS: TrajectoryRun[] = [
  record({ repeat: 0, inputTokens: 100, toolCalls: [CALL], recovery: [RECOVERY] }),
  record({
    repeat: 1, inputTokens: 300, outputTokens: 1100, durationMs: 30, turns: 3, costUsd: 0.2,
    toolCalls: [CALL, { ...CALL, turn: 1 }], recovery: [RECOVERY, { ...RECOVERY, turn: 1 }],
  }),
  record({ condition: "cli-canonical", inputTokens: 500, turns: 4, costUsd: 0.3, success: false }),
  record({ condition: "cli-canonical", repeat: 1, inputTokens: 700, turns: 4, costUsd: 0.4 }),
  record({ adapter: "fake", inputTokens: 999_999, costUsd: 0 }),
  record({ promptHash: "bbbbbbbbbbbb", inputTokens: 42 }),
];

describe("Trajectory report rules from docs/reference/spec.md section 4.12", () => {
  it("A10: every printed measurement equals the value recomputed from the run records", () => {
    const agent = RUNS.filter((run) => run.adapter === "claude" && run.promptHash === "aaaaaaaaaaaa"
      && run.condition === "cli-agent");
    const report = renderTrajectoryReport(RUNS);

    const inputP50 = percentile(agent.map(totalInput), MEDIAN);
    const outputP50 = percentile(agent.map((run) => run.outputTokens), MEDIAN);
    const durationP50 = percentile(agent.map((run) => run.durationMs), MEDIAN);
    const turnsP50 = percentile(agent.map((run) => run.turns), MEDIAN);
    const toolCalls = agent.reduce((sum, run) => sum + run.toolCalls.length, 0);
    const recoveries = agent.reduce((sum, run) => sum + run.recovery.length, 0);
    const totalCost = RUNS.filter((run) => run.adapter === "claude")
      .reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    expect({ inputP50, outputP50, durationP50, turnsP50, toolCalls, recoveries }).toEqual({
      inputP50: 11_144, outputP50: 900, durationP50: 10, turnsP50: 2, toolCalls: 3, recoveries: 3,
    });
    expect(report).toContain(
      `| cli-agent | 2 | 0 | 1.00 | ${inputP50} | ${outputP50} | ${durationP50} | ${turnsP50} | ${toolCalls} | ${recoveries} | 0.11 | 1.00 | 0.97 |`,
    );
    expect(trajectoryTotalCost(RUNS)).toBeCloseTo(totalCost, 10);
    expect(report).toContain(`Total real cost: ${totalCost.toFixed(2)}`);
  });

  it("A10: a failed run lowers the printed success rate of its condition", () => {
    const canonical = summarizeTrajectory(RUNS, {
      promptHash: "aaaaaaaaaaaa", model: "opus", invocation: "claude",
    }).find((s) => s.condition === "cli-canonical");

    expect(canonical?.successRate).toBe(0.5);
    expect(renderTrajectoryReport(RUNS)).toContain("| cli-canonical | 2 | 0 | 0.50 |");
  });

  it("A10: incomplete provider usage is counted but excluded from measurements", () => {
    const runs = [...RUNS, record({ incomparable: true, error: "MISSING_AUTHORITATIVE_USAGE", inputTokens: 999_999 })];
    const agent = summarizeTrajectory(runs, {
      promptHash: "aaaaaaaaaaaa", model: "opus", invocation: "claude",
    }).find((summary) => summary.condition === "cli-agent");

    expect(agent).toMatchObject({ runs: 2, incomparableRuns: 1, inputTokensP50: 11_144 });
    expect(renderTrajectoryReport(runs)).toContain("| cli-agent | 2 | 1 | 1.00 | 11144 |");
  });

  it("A10: fake rows never reach a printed number", () => {
    const summary = summarizeTrajectory(RUNS, {
      promptHash: "aaaaaaaaaaaa", model: "opus", invocation: "claude",
    });

    expect(summary.every((row) => row.runs === 2)).toBe(true);
    expect(renderTrajectoryReport(RUNS)).not.toContain("999999");
  });

  it("A10: unlike prompt, model, or invocation records get separate sections", () => {
    const runs = [
      ...RUNS,
      record({ model: "opus-revision", inputTokens: 43 }),
      record({ invocation: "claude --new-shape", inputTokens: 44 }),
    ];

    expect({
      partitions: trajectoryPartitions(runs),
      reportHasRevision: renderTrajectoryReport(runs).includes(
        "## prompt aaaaaaaaaaaa / model opus-revision / invocation claude",
      ),
    }).toEqual({
      partitions: [
        { promptHash: "aaaaaaaaaaaa", model: "opus", invocation: "claude" },
        { promptHash: "bbbbbbbbbbbb", model: "opus", invocation: "claude" },
        { promptHash: "aaaaaaaaaaaa", model: "opus-revision", invocation: "claude" },
        { promptHash: "aaaaaaaaaaaa", model: "opus", invocation: "claude --new-shape" },
      ],
      reportHasRevision: true,
    });
  });

  it("A10: an empty record set prints no measurement at all", () => {
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

  it("A11: the agent view an evaluation sends is still JSON, so no alternate encoding has been adopted", () => {
    const input = buildPromptInput(root, "button", "agent");

    expect(JSON.parse(input.context)).toHaveProperty("component.block", "button");
    expect(input.context.startsWith("{")).toBe(true);
  });
});
