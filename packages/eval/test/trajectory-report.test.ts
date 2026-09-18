// The trajectory report states measurements, never verdicts. The scoring row of docs/reference/verification.md
// section 2 rejects a false `adopted:` claim but never requires a true one, and the adoption bar itself
// is gate-owned (.claude/rules/verify/gates-are-human-owned.md), so it gets no second home here.
// The scoring gate reads only the committed report, so a renderer that starts claiming adoption before any real
// record exists would reach no gate; this test is the check that runs anyway.
import { describe, expect, it } from "vitest";
import {
  renderTrajectoryReport, supersededTrajectoryCount, survivingTrajectoryRuns, type TrajectoryRun,
} from "../src/index";

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

  it("prints the superseded-row count on its own header line", () => {
    const report = renderTrajectoryReport(ADOPTABLE);

    expect(report.split("\n")).toContain("Superseded rows: 0");
  });
});

/** attemptId marks the run that wrote a row; a missing value is the earliest attempt (empty string). */
const ids = (runs: TrajectoryRun[]): (string | undefined)[] => runs.map((run) => run.attemptId);

describe("trajectory supersede-in-aggregation (SPEC 9.7)", () => {
  it("keeps every row and reports zero superseded when no slot repeats across attempts", () => {
    const runs = [record({ repeat: 0 }), record({ repeat: 1 })];

    expect(survivingTrajectoryRuns(runs)).toHaveLength(2);
    expect(supersededTrajectoryCount(runs)).toBe(0);
  });

  it("supersedes an earlier errored row of a slot with a later comparable row (scenario A)", () => {
    const errored = record({ incomparable: true, success: false, costUsd: null });
    const retry = record({ attemptId: "2026-09-18T00:00:00.000Z" });

    expect(ids(survivingTrajectoryRuns([errored, retry]))).toEqual(["2026-09-18T00:00:00.000Z"]);
    expect(supersededTrajectoryCount([errored, retry])).toBe(1);
  });

  it("keeps an earlier comparable row when the later attempt errors on that slot (scenario B)", () => {
    const good = record({ attemptId: "2026-09-17T00:00:00.000Z" });
    const laterErrored = record({ attemptId: "2026-09-18T00:00:00.000Z", incomparable: true, success: false, costUsd: null });

    expect(ids(survivingTrajectoryRuns([good, laterErrored]))).toEqual(["2026-09-17T00:00:00.000Z"]);
    expect(supersededTrajectoryCount([good, laterErrored])).toBe(1);
  });

  it("keeps the newest errored row and a null total when every attempt errored on the slot", () => {
    const first = record({ attemptId: "2026-09-17T00:00:00.000Z", incomparable: true, success: false, costUsd: null });
    const second = record({ attemptId: "2026-09-18T00:00:00.000Z", incomparable: true, success: false, costUsd: null });

    expect(ids(survivingTrajectoryRuns([first, second]))).toEqual(["2026-09-18T00:00:00.000Z"]);
    expect(renderTrajectoryReport([first, second]).split("\n")).toEqual(
      expect.arrayContaining(["Total real cost: n/a", "Superseded rows: 1"]),
    );
  });

  it("keeps both rows of a tie so an intra-attempt duplicate stays an over-count", () => {
    const one = record({ attemptId: "2026-09-18T00:00:00.000Z", outputTokens: 900 });
    const two = record({ attemptId: "2026-09-18T00:00:00.000Z", outputTokens: 950 });

    expect(survivingTrajectoryRuns([one, two])).toHaveLength(2);
    expect(supersededTrajectoryCount([one, two])).toBe(0);
  });

  it("does not supersede across a different requested model, invocation, or prompt hash", () => {
    const base = record({ attemptId: "2026-09-17T00:00:00.000Z" });
    const otherInvocation = record({ attemptId: "2026-09-18T00:00:00.000Z", invocation: "claude --stream" });

    expect(survivingTrajectoryRuns([base, otherInvocation])).toHaveLength(2);
    expect(supersededTrajectoryCount([base, otherInvocation])).toBe(0);
  });
});
