// The trajectory report states measurements, never verdicts. The scoring row of docs/reference/verification.md
// section 2 rejects a false `adopted:` claim but never requires a true one, and the adoption bar itself
// is gate-owned (.claude/rules/verify/gates-are-human-owned.md), so it gets no second home here.
// The scoring gate reads only the committed report, so a renderer that starts claiming adoption before any real
// record exists would reach no gate; this test is the check that runs anyway.
import { describe, expect, it } from "vitest";
import { renderTrajectoryReport, type TrajectoryRun } from "../src/index";

/** The scoring gate's own rejection predicate: a line naming a condition alongside `adopted`. */
const CONDITIONS = ["cli-canonical", "cli-agent", "mcp-agent"];
const claimsAdoption = (line: string): boolean =>
  /adopted/i.test(line) && CONDITIONS.some((condition) => line.toLowerCase().includes(condition));

function record(over: Partial<TrajectoryRun>): TrajectoryRun {
  return {
    cmd: "trajectory", utcDate: "2026-09-07", task: "known-component", condition: "cli-agent", repeat: 0,
    adapter: "claude", model: "opus", invocation: "claude", success: true, turns: 2, durationMs: 10,
    inputTokens: 100, cacheCreation: 200, cacheRead: 10_844, outputTokens: 900, costUsd: 0.11,
    s1: 1, s2: 0.97, artifact: null, promptHash: "aaaaaaaaaaaa", toolCalls: [], recovery: [], ...over,
  };
}

/** cli-agent dominates cli-canonical on every adoption criterion, so a claiming renderer would claim here. */
const ADOPTABLE: TrajectoryRun[] = [
  record({ repeat: 0 }),
  record({ repeat: 1 }),
  record({ condition: "cli-canonical", repeat: 0, cacheRead: 90_000, turns: 4, success: false, s2: 0.5 }),
  record({ condition: "cli-canonical", repeat: 1, cacheRead: 90_000, turns: 4, success: false, s2: 0.5 }),
];

describe("renderTrajectoryReport", () => {
  it("states no adoption claim even when the records satisfy every adoption criterion", () => {
    const report = renderTrajectoryReport(ADOPTABLE);

    expect(report.split("\n").filter(claimsAdoption)).toEqual([]);
  });
});
