// P8 harness drives task x condition x repeat and aggregates `cmd: "trajectory"` records.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { AgentError, estimateTokens, stableStringify } from "@tokenloom/schema";
import {
  createSessionPort, type ChildRunWithStdin, type RunnableTrajectoryCondition, type ToolPort, type TrajectoryCondition,
  type TrajectoryRecovery, type TrajectoryRun, type TrajectoryTask, type TrajectoryTaskSpec, type TrajectoryToolCall,
  type TrajectoryTurn,
} from "./agent-session-port";
import type { HarnessCommit, LlmAdapter, LlmResult, ModelResolution, ProviderCallEvidence } from "./model-port";
import { promptHash } from "./prompt";
import { readHarnessCommit, runsDir } from "./runs";
import { scoreS1, scoreS2 } from "./score";
import { runCoverage } from "./coverage";
import { expectedVariants } from "./variant-reference";
import { measureS3, renderVariants } from "./visual";
import { percentile, type Rate } from "./stats";

export const TRAJECTORY_REPEATS = 2; // T803 owns the harness; registered so no later lane edits the eval barrel.
const PER_MTOK = 1_000_000;
const MEDIAN = 50;
const SCORE_DIGITS = 4;
const MANIFEST = "samples/manifest.json";
const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** Stop reasons. `UNSTRUCTURED` marks a canonical-view failure, which answers in prose and has no P7 code. */
const UNSTRUCTURED = "UNSTRUCTURED";
const [BUDGET_STOP, MAX_TURNS, NO_REQUEST, PRICING_DEFECT, MISSING_COST,
  NO_SUCCESSFUL_TOOL_CALL, UNRESOLVED_RECOVERY] = [
  "BUDGET_STOP", "MAX_TURNS", "NO_TOOL_REQUEST", "PRICING_DEFECT", "MISSING_AUTHORITATIVE_COST",
  "NO_SUCCESSFUL_TOOL_CALL", "UNRESOLVED_RECOVERY",
];
const TASK_KEYS = /^(?:component|match|variant|node|level|annotations)=/;
const MISSING_USAGE = "MISSING_AUTHORITATIVE_USAGE";

/** Every policy value the cost model needs lives in the YAML, never as a literal in this file. */
const positive = z.number().int().positive();
const Condition = z.enum(["cli-canonical", "cli-agent", "mcp-agent"]);
/** `cli-agent-compact` names the concluded T804 experiment, so archived records read but no new matrix runs. */
const RecordedCondition = z.enum(["cli-canonical", "cli-agent", "mcp-agent", "cli-agent-compact"]);
export const TrajectoryMatrix = z.object({
  model: z.string(), repeats: positive.default(TRAJECTORY_REPEATS), maxTurns: positive, maxOutputTokens: positive,
  budgetUsd: z.number().positive(),
  /** Measured provider-side prefix billed on every call, independent of the condition. */
  sessionPrefixTokens: z.number().int().nonnegative(),
  /** Measured per-call instruction block the provider bills as a cache write outside the harness prompt. */
  sessionWriteTokens: z.number().int().nonnegative(),
  conditions: z.array(Condition).min(1),
  prompt: z.object({
    instructions: z.string(),
    views: z.record(Condition, z.string()) as z.ZodType<Record<RunnableTrajectoryCondition, string>>,
  }),
  tasks: z.array(z.object({ task: z.enum(["known-component", "unknown-component", "variant-only", "recovery"]),
    sampleName: z.string(), snapshot: z.string(), instruction: z.string(), variant: z.string().optional() })).min(1),
});
export type TrajectoryMatrixT = z.infer<typeof TrajectoryMatrix>;

/** Resolving each task's `variant` proves it names a base or one variant, so an ambiguous or unknown
 *  selector fails at load rather than after a provider call. Requires the snapshots, so the caller
 *  passes `repoRoot`; a caller without it validates schema shape only. */
function validateTrajectoryVariants(matrix: TrajectoryMatrixT, repoRoot: string): void {
  for (const task of matrix.tasks) {
    if (task.variant !== undefined) expectedVariants(repoRoot, { sampleName: task.sampleName, variant: task.variant });
  }
}

export function loadTrajectoryMatrix(path: string, repoRoot?: string): TrajectoryMatrixT {
  const matrix = TrajectoryMatrix.parse(parse(readFileSync(path, "utf8")));
  if (repoRoot !== undefined) validateTrajectoryVariants(matrix, repoRoot);
  return matrix;
}

export interface TrajectoryOptions {
  repoRoot: string; matrix: TrajectoryMatrixT; utcDate: string;
  /** A fresh adapter per turn carries that turn's provider-enforced budget; the fake path ignores it. */
  makeAdapter: (perCallBudgetUsd: number, effectiveOutputTokenCap: number) => LlmAdapter;
  toolPortFor: (condition: RunnableTrajectoryCondition) => ToolPort;
  /** Absent pricing leaves no pre-call bound, so only a free adapter may run. */
  rate: Rate | null;
  /** Used once, to read the reference lock commit that pins a scored artifact's input. */
  child: ChildRunWithStdin;
}

/** `stopped` names why the set ended early, or null when every combination ran. */
export interface TrajectorySet { records: TrajectoryRun[]; costUsd: number; stopped: Stop; path: string | null }
type Stop = "budget" | "pricing" | null;
interface Combination { spec: TrajectoryTaskSpec; condition: RunnableTrajectoryCondition; repeat: number }
interface SetState { lock: string; harnessCommit: HarnessCommit; adapter: LlmAdapter["kind"]; remaining: number; stopped: Stop }

/**
 * Pre-call bound from the prompt, both measured per-call blocks, and capped output. Reserving the
 * cache-written instruction block matters: without it the provider bills input the bound never set
 * aside, the remainder no longer covers `maxOutputTokens`, and a long transcript makes the provider
 * refuse its own `--max-budget-usd` mid-answer.
 */
function boundedInputCost(promptBytes: number, matrix: TrajectoryMatrixT, rate: Rate): number {
  return ((estimateTokens(promptBytes) + matrix.sessionWriteTokens) * rate.cacheWrite1hPerMTok
    + matrix.sessionPrefixTokens * rate.cacheReadPerMTok) / PER_MTOK;
}

export function costUpperBound(promptBytes: number, matrix: TrajectoryMatrixT, rate: Rate): number {
  return boundedInputCost(promptBytes, matrix, rate) + matrix.maxOutputTokens * rate.outputPerMTok / PER_MTOK;
}

/** Output cap implied by the dollar ceiling after reserving the bounded prompt and session-prefix cost. */
export function effectiveOutputTokenCap(
  perCallBudgetUsd: number, promptBytes: number, matrix: TrajectoryMatrixT, rate: Rate,
): number {
  return (perCallBudgetUsd - boundedInputCost(promptBytes, matrix, rate)) * PER_MTOK / rate.outputPerMTok;
}

/** Deterministic expansion by task, condition, then repeat. */
export function trajectoryCombinations(matrix: TrajectoryMatrixT): Combination[] {
  const repeats = [...Array(matrix.repeats).keys()];
  return matrix.tasks.flatMap((spec) =>
    matrix.conditions.flatMap((condition) => repeats.map((repeat) => ({ spec, condition, repeat }))));
}

/** --dry-run evidence: the planned set and its estimated opening input, produced without a model call. */
export function planTrajectory(matrix: TrajectoryMatrixT): { runs: number; estInputTokens: number } {
  const combos = trajectoryCombinations(matrix);
  const est = (c: Combination): number => matrix.sessionPrefixTokens + estimateTokens(Buffer.byteLength(
    createSessionPort(c.condition, matrix.tasks, matrix.prompt).openingPrompt(c.spec.task), "utf8"));
  return { runs: combos.length, estInputTokens: combos.reduce((sum, combo) => sum + est(combo), 0) };
}

/** The harness fixes the snapshot and the view so a condition cannot drift into another payload shape. */
function toolArgs(condition: RunnableTrajectoryCondition, spec: TrajectoryTaskSpec, modelArgs: string[]): string[] {
  const view = condition === "cli-canonical" ? "canonical" : "agent";
  return [...modelArgs.filter((arg) => TASK_KEYS.test(arg)), `from=${spec.snapshot}`, `view=${view}`];
}

/** A structured Agent error names its own recovery reason; the canonical view has none to name. */
function errorCode(content: string): string {
  try {
    return AgentError.safeParse(JSON.parse(content)).data?.error.code ?? UNSTRUCTURED;
  } catch { return UNSTRUCTURED; }
}

/** An empty file is a measured set with zero names; a missing file leaves S1 unmeasurable. */
function readTokensCss(repoRoot: string, sampleName: string): string | null {
  const path = resolve(repoRoot, "samples", sampleName, "reference/css/tokens.css");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function validateReferenceInputs(repoRoot: string, matrix: TrajectoryMatrixT, lockedManifest: string): void {
  const manifest = JSON.parse(lockedManifest) as Record<string, string>;
  const inputs = new Map<string, () => string | null>();
  for (const task of matrix.tasks) {
    inputs.set(`samples/${task.sampleName}/reference/css/tokens.css`, () => readTokensCss(repoRoot, task.sampleName));
    inputs.set(task.snapshot, () => existsSync(resolve(repoRoot, task.snapshot))
      ? readFileSync(resolve(repoRoot, task.snapshot), "utf8") : null);
  }
  for (const [path, read] of inputs) {
    const content = manifest[path] === undefined ? null : read();
    if (content === null || manifest[path] !== `sha256:${sha256(content)}`)
      throw new Error(`trajectory: reference input mismatch: ${path}`);
  }
}

/** One run of the harness-mediated loop. Budget is checked between turns only, never mid-call. */
async function runOne(options: TrajectoryOptions, combo: Combination, state: SetState): Promise<TrajectoryRun> {
  const { matrix, repoRoot } = options;
  const port = createSessionPort(combo.condition, matrix.tasks, matrix.prompt);
  const toolPort = options.toolPortFor(combo.condition);
  const turns: TrajectoryTurn[] = [];
  const toolCalls: TrajectoryToolCall[] = [];
  const recovery: TrajectoryRecovery[] = [];
  const usage = { inputTokens: 0, cacheCreation: 0, cacheRead: 0, outputTokens: 0 };
  const started = Date.now();
  let [prompt, model, invocation] = [port.openingPrompt(combo.spec.task), matrix.model, ""];
  let error: string | undefined;
  let incomparable = false;
  let costUsd: number | null = null;

  for (let index = 0; index < matrix.maxTurns; index += 1) {
    const promptBytes = Buffer.byteLength(prompt, "utf8");
    const bound = options.rate === null ? 0 : costUpperBound(promptBytes, matrix, options.rate);
    const outputCap = options.rate === null ? matrix.maxOutputTokens
      : effectiveOutputTokenCap(bound, promptBytes, matrix, options.rate);
    if (bound > state.remaining) { costUsd ??= 0; error = BUDGET_STOP; state.stopped = "budget"; break; }
    const target = { sampleName: combo.spec.sampleName, model: matrix.model, repoRoot };
    const result = await options.makeAdapter(bound, outputCap).run(prompt, target);
    incomparable ||= result.error?.startsWith(MISSING_USAGE) === true;
    for (const key of Object.keys(usage) as (keyof typeof usage)[]) usage[key] += result[key];
    [model, invocation] = [result.model, result.invocation];
    if (result.costUsd !== null) {
      costUsd = (costUsd ?? 0) + result.costUsd;
      state.remaining -= result.costUsd;
      if (options.rate !== null && result.costUsd > bound) { error = PRICING_DEFECT; state.stopped = "pricing"; }
    } else if (state.adapter === "claude") {
      error = detail(MISSING_COST, result.error);
      state.stopped = "pricing";
    }
    turns.push({ index, prompt, result, toolCall: null });
    if (error !== undefined) break;
    if (result.error !== undefined) { error = result.error; break; }
    if (port.isComplete(turns)) break;
    const request = port.parseToolRequest(result.text);
    if (request === null) { error = NO_REQUEST; break; }
    const args = toolArgs(combo.condition, combo.spec, request.args);
    const res = await toolPort.call({ tool: request.tool, args, stdin: null });
    // A canonical failure prints on stderr only, which is why the child boundary returns both streams.
    const output = res.content.trim() === "" ? res.stderr : res.content;
    toolCalls.push({ turn: index, tool: request.tool, args, exitCode: res.exitCode, bytes: Buffer.byteLength(output, "utf8") });
    if (res.exitCode === 0) for (const entry of recovery) entry.resolved = true;
    else recovery.push({ turn: index, code: errorCode(res.content), resolved: false });
    prompt = port.followUpPrompt(turns, output);
    if (index === matrix.maxTurns - 1) error = MAX_TURNS;
  }

  const complete = port.isComplete(turns);
  if (state.adapter === "claude" && complete && error === undefined) {
    if (recovery.some((entry) => !entry.resolved)) error = UNRESOLVED_RECOVERY;
    else if (!toolCalls.some((call) => call.exitCode === 0)) error = NO_SUCCESSFUL_TOOL_CALL;
  }
  const success = complete && error === undefined;
  const text = turns[turns.length - 1]?.result.text ?? "";
  const tokensCss = readTokensCss(repoRoot, combo.spec.sampleName);
  const scored = complete && tokensCss !== null;
  const coverage = runCoverage(repoRoot, { sampleName: combo.spec.sampleName, variant: combo.spec.variant }, text);
  const s3 = coverage.coverageStatus === "measured"
    ? await measureS3({
        repoRoot, target: { sampleName: combo.spec.sampleName },
        expected: expectedVariants(repoRoot, { sampleName: combo.spec.sampleName, variant: combo.spec.variant }),
        text, render: renderVariants, readPng: (path) => readFileSync(path),
      })
    : null;
  const results = turns.map((t) => t.result);
  const providerEvidence = results
    .map((r) => r.providerEvidence).filter((e): e is ProviderCallEvidence => e !== null);
  const resolved = sharedResolvedModel(results);
  return {
    coverageStatus: coverage.coverageStatus,
    ...(coverage.coverage !== null ? { coverage: coverage.coverage } : {}),
    ...(coverage.coverageError === undefined ? {} : { coverageError: coverage.coverageError }),
    ...(s3 === null ? {} : { s3: s3.s3, s3Status: s3.s3Status, s3Detail: s3.s3Detail }),
    cmd: "trajectory", utcDate: options.utcDate, task: combo.spec.task, condition: combo.condition,
    repeat: combo.repeat, adapter: state.adapter, model, invocation, success,
    turns: turns.length, durationMs: Date.now() - started, ...usage, costUsd,
    s1: scored ? scoreS1(text, tokensCss) : null,
    s2: scored ? Number(scoreS2(text).toFixed(SCORE_DIGITS)) : null,
    artifact: scored
      ? { output: text, sampleName: combo.spec.sampleName, tokensCssSha256: sha256(tokensCss), referenceLockCommit: state.lock }
      : null,
    promptHash: promptHash(port.template), toolCalls, recovery, ...(incomparable ? { incomparable } : {}),
    requestedModel: matrix.model, resolvedModel: resolved.resolvedModel, modelResolution: resolved.modelResolution,
    providerEvidence, harnessCommit: state.harnessCommit, referenceLockCommit: state.lock,
    ...(error === undefined ? {} : { error }),
  };
}

function sharedResolvedModel(
  results: LlmResult[],
): { resolvedModel: string | null; modelResolution: ModelResolution | null } {
  const models = new Set(results.map((r) => r.resolvedModel));
  if (results.length === 0 || models.size !== 1 || models.has(null)) return { resolvedModel: null, modelResolution: null };
  const resolutions = new Set(results.map((r) => r.modelResolution));
  const first = results[0] as LlmResult;
  return { resolvedModel: first.resolvedModel, modelResolution: resolutions.size === 1 ? first.modelResolution : null };
}

/** Runs every combination in order, stopping the whole set at the first budget or pricing stop. */
export async function runTrajectory(options: TrajectoryOptions): Promise<TrajectorySet> {
  // The commit that last locked the reference inputs a recomputed S1 and S2 must be read against.
  const log = await options.child("git", ["log", "-1", "--format=%H", "--", MANIFEST], options.repoRoot);
  const lock = log.stdout.trim();
  if (log.code !== 0 || !COMMIT_SHA.test(lock)) throw new Error("trajectory: reference-lock lookup failed");
  const manifest = await options.child("git", ["show", `${lock}:${MANIFEST}`], options.repoRoot);
  if (manifest.code !== 0) throw new Error("trajectory: reference-lock lookup failed");
  validateReferenceInputs(options.repoRoot, options.matrix, manifest.stdout);
  const harnessCommit = await readHarnessCommit(options.child, options.repoRoot);
  const adapter = options.makeAdapter(0, 0);
  if (adapter.kind === "claude" && options.rate === null) throw new Error("trajectory: missing pricing for claude adapter");
  const state: SetState = {
    lock, harnessCommit, adapter: adapter.kind, remaining: options.matrix.budgetUsd, stopped: null,
  };
  const records: TrajectoryRun[] = [];
  for (const combo of trajectoryCombinations(options.matrix)) {
    records.push(await runOne(options, combo, state));
    if (state.stopped !== null) break;
  }
  const costUsd = records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  return { records, costUsd, stopped: state.stopped, path: appendTrajectoryRuns(options.repoRoot, options.utcDate, records) };
}

/** Appends to the runs directory, honouring `TOKENLOOM_RUNS_DIR` exactly as the eval writer does. */
export function appendTrajectoryRuns(repoRoot: string, utcDate: string, records: TrajectoryRun[]): string | null {
  if (records.length === 0) return null;
  mkdirSync(runsDir(repoRoot), { recursive: true });
  const path = join(runsDir(repoRoot), `${utcDate}.jsonl`);
  appendFileSync(path, records.map((record) => stableStringify(record, 0)).join("\n") + "\n");
  return path;
}

const TrajectoryRow = z.object({
  cmd: z.literal("trajectory"), condition: RecordedCondition, adapter: z.enum(["fake", "claude"]),
  model: z.string(), invocation: z.string(), promptHash: z.string(), success: z.boolean(),
  turns: z.number(), durationMs: z.number(), inputTokens: z.number(), cacheCreation: z.number(),
  cacheRead: z.number(), outputTokens: z.number(), costUsd: z.number().nullable(),
  s1: z.number().nullable(), s2: z.number().nullable(), toolCalls: z.array(z.unknown()),
  recovery: z.array(z.unknown()), incomparable: z.boolean().optional(), error: z.string().optional(),
}).passthrough();

/** Trajectory rows in the runs directory. The eval reader keeps `cmd: "eval"`, so the two never mix. */
export function readTrajectoryRuns(repoRoot: string): TrajectoryRun[] {
  const dir = runsDir(repoRoot);
  if (!existsSync(dir)) return [];
  const lines = readdirSync(dir).sort().filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter((line) => line.trim() !== ""));
  return lines.map((line) => JSON.parse(line)).filter((record) => record.cmd === "trajectory")
    .map((record) => TrajectoryRow.parse(record) as unknown as TrajectoryRun);
}

/** Total input of one run: the three provider input categories, so prompt caching cannot move it. */
export const totalInput = (run: TrajectoryRun): number => run.inputTokens + run.cacheCreation + run.cacheRead;

/** Fake rows record the deterministic path and are excluded from every aggregate. */
export const realTrajectoryRuns = (runs: TrajectoryRun[]): TrajectoryRun[] => runs.filter((r) => r.adapter === "claude");

export function trajectoryTotalCost(runs: TrajectoryRun[]): number | null {
  const real = realTrajectoryRuns(runs);
  return real.length === 0 || real.some((run) => run.costUsd === null)
    ? null : real.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
}

/** The comparison shape: required tasks and conditions mirror eval/trajectory.yaml, which the gate also reads. */
export const REQUIRED_TASKS: readonly TrajectoryTask[] = ["known-component", "unknown-component", "variant-only", "recovery"];
export const REQUIRED_CONDITIONS: readonly RunnableTrajectoryCondition[] = ["cli-canonical", "cli-agent", "mcp-agent"];

/** The requested-model alias the header prints; a legacy row without the field falls back to `model`. */
const requestedModelOf = (run: TrajectoryRun): string => run.requestedModel ?? run.model;
/** Absent and explicit-null resolvedModel both normalize to null, and null equals only null. */
const resolvedModelOf = (run: TrajectoryRun): string | null => run.resolvedModel ?? null;

export interface TrajectoryPartition { promptHash: string; requestedModel: string; resolvedModel: string | null; invocation: string }

const partitionOf = (run: TrajectoryRun): TrajectoryPartition => ({
  promptHash: run.promptHash, requestedModel: requestedModelOf(run), resolvedModel: resolvedModelOf(run), invocation: run.invocation,
});
const inPartition = (run: TrajectoryRun, p: TrajectoryPartition): boolean =>
  run.promptHash === p.promptHash && requestedModelOf(run) === p.requestedModel
  && resolvedModelOf(run) === p.resolvedModel && run.invocation === p.invocation;
const realInPartition = (runs: TrajectoryRun[], p: TrajectoryPartition): TrajectoryRun[] =>
  realTrajectoryRuns(runs).filter((run) => inPartition(run, p));

/** Comparable partitions in first-seen order; rows differing in prompt or model provenance never merge. */
export function trajectoryPartitions(runs: TrajectoryRun[]): TrajectoryPartition[] {
  const unique = new Map<string, TrajectoryPartition>();
  for (const run of realTrajectoryRuns(runs)) unique.set(JSON.stringify(partitionOf(run)), partitionOf(run));
  return [...unique.values()];
}

/** One (task, condition) cell: recorded rows, comparable rows (usage present), and successes among comparable. */
export interface TrajectoryCell {
  task: TrajectoryTask; condition: RunnableTrajectoryCondition; recorded: number; comparable: number; successes: number;
}

export function trajectoryCells(runs: TrajectoryRun[], partition: TrajectoryPartition): TrajectoryCell[] {
  const rows = realInPartition(runs, partition);
  return REQUIRED_TASKS.flatMap((task) => REQUIRED_CONDITIONS.map((condition) => {
    const all = rows.filter((run) => run.task === task && run.condition === condition);
    const comparable = all.filter((run) => run.incomparable !== true);
    return {
      task, condition, recorded: all.length, comparable: comparable.length,
      successes: comparable.filter((run) => run.success).length,
    };
  }));
}

/** Required (task, repeat) slots with no recorded row; the incomplete-task-coverage flag, distinct from incomparable. */
function conditionMissingRuns(rows: TrajectoryRun[], condition: TrajectoryCondition): number {
  return REQUIRED_TASKS.reduce((sum, task) => {
    const recorded = rows.filter((run) => run.condition === condition && run.task === task).length;
    return sum + Math.max(0, TRAJECTORY_REPEATS - recorded);
  }, 0);
}

/** Raw success count for one cell; never a percentage, and a small `r` is marked `short`. */
export function renderCountCell(cell: TrajectoryCell): string {
  if (cell.recorded === 0) return "-";
  const short = cell.recorded < TRAJECTORY_REPEATS ? " short" : "";
  const incomparable = cell.recorded - cell.comparable;
  const suffix = incomparable > 0 ? ` (+${incomparable} incomparable)` : "";
  return `${cell.successes}/${cell.comparable}${short}${suffix}`;
}

/** A condition-wide count only when every required task has a full comparable set; otherwise a word, no number. */
export function renderAllTasksCell(cells: TrajectoryCell[]): string {
  if (cells.every((cell) => cell.comparable >= TRAJECTORY_REPEATS)) {
    const successes = cells.reduce((sum, cell) => sum + cell.successes, 0);
    const comparable = cells.reduce((sum, cell) => sum + cell.comparable, 0);
    return `${successes}/${comparable}`;
  }
  const missing = cells.reduce((sum, cell) => sum + Math.max(0, TRAJECTORY_REPEATS - cell.recorded), 0);
  return missing > 0 ? "incomplete" : "incomparable";
}

/** Per-condition diagnostics; medians over each condition's own runs, so this is not the fair comparison. */
export interface ConditionSummary {
  condition: TrajectoryCondition; primary: boolean; runs: number; incomparableRuns: number; missingRuns: number;
  inputTokensP50: number | null; outputTokensP50: number | null; durationMsP50: number | null; turnsP50: number | null;
  toolCalls: number; recoveries: number; costP50: number | null; s1P50: number | null; s2P50: number | null;
  coverageP50: number | null; s3P50: number | null;
}

const coverageRecallOf = (run: TrajectoryRun): number =>
  run.coverageStatus === "measured" && run.coverage != null ? run.coverage.variantRecall : Number.NaN;
const s3Of = (run: TrajectoryRun): number => typeof run.s3 === "number" ? run.s3 : Number.NaN;
const isRequiredCondition = (condition: TrajectoryCondition): boolean =>
  (REQUIRED_CONDITIONS as readonly string[]).includes(condition);

/** Diagnostics rows: required conditions first in config order, then any other recorded condition alphabetically. */
export function summarizeTrajectory(runs: TrajectoryRun[], partition: TrajectoryPartition): ConditionSummary[] {
  const rows = realInPartition(runs, partition);
  const present = [...new Set(rows.map((run) => run.condition))];
  const ordered = [
    ...REQUIRED_CONDITIONS.filter((condition) => present.includes(condition)),
    ...present.filter((condition) => !isRequiredCondition(condition)).sort(),
  ];
  return ordered.map((condition) => {
    const all = rows.filter((run) => run.condition === condition);
    const group = all.filter((run) => run.incomparable !== true);
    const at50 = (of: (run: TrajectoryRun) => number): number | null => percentile(group.map(of), MEDIAN);
    return {
      condition, primary: isRequiredCondition(condition), runs: group.length, incomparableRuns: all.length - group.length,
      missingRuns: conditionMissingRuns(rows, condition),
      inputTokensP50: at50(totalInput), outputTokensP50: at50((run) => run.outputTokens),
      durationMsP50: at50((run) => run.durationMs), turnsP50: at50((run) => run.turns),
      toolCalls: group.reduce((sum, run) => sum + run.toolCalls.length, 0),
      recoveries: group.reduce((sum, run) => sum + run.recovery.length, 0),
      costP50: at50((run) => run.costUsd ?? Number.NaN), s1P50: at50((run) => run.s1 ?? Number.NaN),
      s2P50: at50((run) => run.s2 ?? Number.NaN), coverageP50: at50(coverageRecallOf), s3P50: at50(s3Of),
    };
  });
}

/** Keeps the adapter's diagnostic beside the harness code, so a stop is readable without the child. */
const detail = (code: string, cause: string | undefined): string =>
  cause === undefined || cause === "" ? code : `${code}: ${cause}`;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
