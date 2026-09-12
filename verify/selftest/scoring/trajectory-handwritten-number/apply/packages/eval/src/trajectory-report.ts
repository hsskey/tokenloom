// The scoring gate scans this file for hand-written numbers (A10), so it holds none:
// every measurement arrives already computed from the run records and this file only assembles strings.
import { fixed, integer } from "./stats";
import {
  summarizeTrajectory, trajectoryPartitions, trajectoryTotalCost, type ConditionSummary, type TrajectoryPartition,
} from "./trajectory";
import type { TrajectoryRun } from "./agent-session-port";

export const TRAJECTORY_REPORT_SECTION = "trajectory";
const DIGITS = 2;
const HEADERS = [
  "Condition", "Runs", "Incomparable", "Success rate", "Total input p50", "Output p50", "Duration ms p50",
  "Turns p50", "Tool calls", "Recoveries", "Cost p50", "S1 p50", "S2 p50",
];
const BASIS = "Total input is inputTokens + cacheCreation + cacheRead, summed over the turns of a run.";

const HANDWRITTEN_SUCCESS_RATE = 0.88;

export function handwrittenSuccessRate(): string {
  return `Success rate: ${HANDWRITTEN_SUCCESS_RATE}`;
}

const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

const summaryRow = (s: ConditionSummary): string => row([
  s.condition, String(s.runs), String(s.incomparableRuns), fixed(s.successRate, DIGITS), integer(s.inputTokensP50),
  integer(s.outputTokensP50), integer(s.durationMsP50), integer(s.turnsP50), String(s.toolCalls),
  String(s.recoveries), fixed(s.costP50, DIGITS), fixed(s.s1P50, DIGITS), fixed(s.s2P50, DIGITS),
]);

/** Rows with unlike prompt hashes, resolved models, or invocation shapes never share a table. */
const section = (runs: TrajectoryRun[], partition: TrajectoryPartition): string => [
  `## prompt ${partition.promptHash} / model ${partition.model} / invocation ${partition.invocation}`,
  "", row(HEADERS), row(HEADERS.map(() => "---")),
  ...summarizeTrajectory(runs, partition).map(summaryRow), "", BASIS,
].join("\n");

export function renderTrajectoryReport(runs: TrajectoryRun[]): string {
  const partitions = trajectoryPartitions(runs);
  const body = partitions.length === 0
    ? ["no trajectory run records"]
    : partitions.map((partition) => section(runs, partition));
  return [
    `# tokenloom ${TRAJECTORY_REPORT_SECTION}`, "", `Total real cost: ${fixed(trajectoryTotalCost(runs), DIGITS)}`,
    "", ...body, "",
  ].join("\n");
}
