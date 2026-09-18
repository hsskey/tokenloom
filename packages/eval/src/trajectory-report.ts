// The scoring gate scans this file for hand-written numbers (A10), so it holds none:
// every measurement arrives already computed from the run records and this file only assembles strings.
import { fixed, integer } from "./stats";
import {
  REQUIRED_CONDITIONS, REQUIRED_TASKS, renderAllTasksCell, renderCountCell, summarizeTrajectory,
  supersededTrajectoryCount, survivingTrajectoryRuns, trajectoryCells, trajectoryPartitions, trajectoryTotalCost,
  type ConditionSummary, type TrajectoryCell, type TrajectoryPartition,
} from "./trajectory";
import type { TrajectoryRun } from "./agent-session-port";

export const TRAJECTORY_REPORT_SECTION = "trajectory";
const DIGITS = 2;
const PRIMARY_HEADERS = ["Task", ...REQUIRED_CONDITIONS];
const DIAGNOSTIC_HEADERS = [
  "Condition", "Primary", "Runs", "Incomparable", "Missing runs", "Total input p50", "Output p50",
  "Duration ms p50", "Turns p50", "Tool calls", "Recoveries", "Cost p50", "S1 p50", "S2 p50",
  "Coverage p50", "S3 p50",
];
const BASIS = "Total input is inputTokens + cacheCreation + cacheRead, summed over the turns of a run.";

const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;
const separator = (headers: string[]): string => row(headers.map(() => "---"));

const diagnosticRow = (s: ConditionSummary): string => row([
  s.condition, s.primary ? "yes" : "no", String(s.runs), String(s.incomparableRuns), String(s.missingRuns),
  integer(s.inputTokensP50), integer(s.outputTokensP50), integer(s.durationMsP50), integer(s.turnsP50),
  String(s.toolCalls), String(s.recoveries), fixed(s.costP50, DIGITS), fixed(s.s1P50, DIGITS),
  fixed(s.s2P50, DIGITS), fixed(s.coverageP50, DIGITS), fixed(s.s3P50, DIGITS),
]);

const cellsOf = (cells: TrajectoryCell[], condition: string): TrajectoryCell[] =>
  cells.filter((cell) => cell.condition === condition);

/** A cell is always present in trajectoryCells; an absent one would mean no runs, which reads as `-`. */
const primaryRows = (cells: TrajectoryCell[]): string[] => [
  ...REQUIRED_TASKS.map((task) => row([task, ...REQUIRED_CONDITIONS.map((condition) => {
    const cell = cells.find((candidate) => candidate.task === task && candidate.condition === condition);
    return cell === undefined ? "-" : renderCountCell(cell);
  })])),
  row(["All tasks", ...REQUIRED_CONDITIONS.map((condition) => renderAllTasksCell(cellsOf(cells, condition)))]),
];

/** Rows with unlike prompt hashes, model provenance, or invocation shapes never share a section. */
const section = (runs: TrajectoryRun[], partition: TrajectoryPartition): string => {
  const cells = trajectoryCells(runs, partition);
  return [
    `## prompt ${partition.promptHash} / model ${partition.requestedModel}`
      + ` / resolved ${partition.resolvedModel ?? "n/a"} / invocation ${partition.invocation}`,
    "", "### Task success by condition (raw counts)", "",
    row(PRIMARY_HEADERS), separator(PRIMARY_HEADERS), ...primaryRows(cells), "",
    "### Per-condition diagnostics (medians over each condition's own runs; not the comparison)", "",
    row(DIAGNOSTIC_HEADERS), separator(DIAGNOSTIC_HEADERS),
    ...summarizeTrajectory(runs, partition).map(diagnosticRow), "", BASIS,
  ].join("\n");
};

export function renderTrajectoryReport(runs: TrajectoryRun[]): string {
  // Supersede runs once over the whole record set before partitioning, so every table below reflects survivors only.
  const survivors = survivingTrajectoryRuns(runs);
  const partitions = trajectoryPartitions(survivors);
  const body = partitions.length === 0
    ? ["no trajectory run records"]
    : partitions.map((partition) => section(survivors, partition));
  return [
    `# tokenloom ${TRAJECTORY_REPORT_SECTION}`, "", `Total real cost: ${fixed(trajectoryTotalCost(survivors), DIGITS)}`,
    `Superseded rows: ${supersededTrajectoryCount(runs)}`,
    "", ...body, "",
  ].join("\n");
}
