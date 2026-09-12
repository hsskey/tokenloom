// Every report number is computed here so report.ts only assembles strings. The report-evidence
// gate depends on that split.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalRun } from "./runs";

export interface Thresholds {
  s1: number;
  s2: number;
  s3: number;
}

/** Thresholds come only from eval/thresholds.json rather than code literals. */
export function readThresholds(repoRoot: string): Thresholds {
  return JSON.parse(readFileSync(resolve(repoRoot, "eval/thresholds.json"), "utf8")) as Thresholds;
}

export interface Rate {
  /** Actual billed model ID recorded alongside the matrix `model` alias (SPEC 9.1). */
  resolvedModel: string;
  inputPerMTok: number;
  /** Prompt-body rate from the pricing page's `1h cache writes` column. */
  cacheWrite1hPerMTok: number;
  /** Repeated-prompt and session-prefix rate from `Cache hits and refreshes`. */
  cacheReadPerMTok: number;
  outputPerMTok: number;
}

/** Rates copied from the official pricing page with their source rather than embedded in code. */
export interface Pricing {
  source: { url: string; checkedAt: string };
  models: Record<string, Rate>;
}

export function readPricing(repoRoot: string): Pricing | null {
  const path = resolve(repoRoot, "eval/pricing.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Pricing) : null;
}

/** Planning headroom used only for the recommended `--budget-usd`, not model correction. */
export interface BudgetPlanning {
  factor: number;
  reason: string;
}

export interface Planning {
  budget: BudgetPlanning;
  decidedAt: string;
}

/** Maintainer-selected headroom read from a file like pricing, rather than embedded in code. */
export function readPlanning(repoRoot: string): Planning | null {
  const path = resolve(repoRoot, "eval/planning.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Planning) : null;
}

export interface OutputBasis {
  /** Baseline prompt hash, or null when rows match only by model. */
  promptHash: string | null;
  lines: number;
  /** Mean rather than median because this estimates a total (SPEC 9.6). */
  outputTokensMean: number | null;
}

/**
 * Output-token baseline. Uses sent rows and prefers an equal prompt hash within the model. Rows with
 * a different hash are unsuitable for the same table (SPEC 9.6), but can provide an order-of-magnitude
 * estimate whose weaker basis is returned explicitly.
 */
export function outputBasis(runs: EvalRun[], model: string, promptHash: string): OutputBasis {
  const sent = runs.filter((r) => r.adapter === "claude" && r.skipped === undefined && r.model === model);
  const sameHash = sent.filter((r) => r.promptHash === promptHash);
  const picked = sameHash.length > 0 ? sameHash : sent;
  return {
    promptHash: sameHash.length > 0 ? promptHash : null,
    lines: picked.length,
    outputTokensMean: mean(picked.map((r) => r.outputTokens)),
  };
}

export interface CostBasis {
  /** Baseline prompt hash, or null when rows match only by model. */
  promptHash: string | null;
  lines: number;
  /** Slope of `cacheCreation = ratio x estTokens + overhead`, or null with fewer than two rows. */
  ratio: number | null;
  /** Intercept representing per-call tokens outside the prompt body. */
  overhead: number | null;
  /** Session-prefix tokens read from cache per call (p50). */
  cacheReadPerCall: number | null;
}

/**
 * Input-cost baseline. Selects rows like `outputBasis`, then keeps cache writes because only they
 * reveal the prompt's billed token count. All coefficients are derived here (SPEC 9.6).
 */
export function costBasis(runs: EvalRun[], model: string, promptHash: string): CostBasis {
  const wrote = runs.filter(
    (r) => r.adapter === "claude" && r.skipped === undefined && r.model === model && r.cacheCreation > 0);
  const sameHash = wrote.filter((r) => r.promptHash === promptHash);
  const picked = sameHash.length > 0 ? sameHash : wrote;
  const line = leastSquares(picked.map((r) => r.estTokens), picked.map((r) => r.cacheCreation));
  return {
    promptHash: sameHash.length > 0 ? promptHash : null,
    lines: picked.length,
    ratio: line?.slope ?? null,
    overhead: line?.intercept ?? null,
    cacheReadPerCall: percentile(picked.map((r) => r.cacheRead), 50),
  };
}

/** Returns null when fewer than two points or equal x values cannot identify slope and intercept. */
function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
  const [sx, sy] = [sum(xs), sum(ys)];
  const denominator = n * sum(xs.map((x) => x * x)) - sx * sx;
  if (denominator === 0) return null;
  const slope = (n * sum(xs.map((x, i) => x * (ys[i] ?? 0))) - sx * sy) / denominator;
  return { slope, intercept: (sy - slope * sx) / n };
}

export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function mean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export function fixed(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

export function integer(value: number | null): string {
  return value === null ? "n/a" : String(Math.round(value));
}

export interface Row {
  /** Keeps sample-design and synthetic rows separate so MCP comparisons remain paired (SPEC 9.6). */
  class: string;
  input: string;
  inputVariant: string;
  s1: string;
  s2: string;
  s3: string;
  inputTokensP50: string;
  costP50: string;
  latencyP50: string;
}

export interface Failure {
  item: string;
  mode: string;
  retryWhen: string;
}

export interface FixedCost {
  input: string;
  sessionSchemaTokens: string;
  tokensPerComponentP50: string;
}

export interface ReportModel {
  date: string;
  model: string;
  promptHash: string;
  mcpCaptures: string;
  rows: Row[];
  failures: Failure[];
  fixedCosts: FixedCost[];
  sampleNotes: string[];
}

const SCORE_DIGITS = 2;
const RATE_DIGITS = 2;
const COST_DIGITS = RATE_DIGITS + RATE_DIGITS;
const REAL_FILE = "real-";
const CLASS_REAL = "Sample designs";
const CLASS_SYNTHETIC = "Synthetic test data";

/**
 * Classification comes from canonical `sampleName`; historical JSONL keys are decoded before aggregation.
 * Although `source.kind` is authoritative, consulting current sample state would make one run line move
 * between tables over time.
 */
function sampleClass(run: EvalRun): string {
  return run.sampleName.startsWith(REAL_FILE) ? CLASS_REAL : CLASS_SYNTHETIC;
}

/** Only compact design context contains tokensUsed (R17); raw and MCP preserve their source forms. */
function namesTokens(run: EvalRun): boolean {
  return run.input !== "mcp" && run.inputVariant !== "raw";
}

function groupKey(run: EvalRun): string {
  return `${sampleClass(run)}\u0000${run.input}\u0000${run.inputVariant}`;
}

/** Prompt hashes that partition report sections, preserving first appearance (SPEC 9.6). */
export function promptHashes(runs: EvalRun[]): string[] {
  return [...new Set(runs.filter((r) => r.adapter === "claude").map((r) => r.promptHash))];
}

/** Aggregates real calls only so fake rows cannot contaminate report values. */
export function realRuns(runs: EvalRun[], model?: string, promptHash?: string): EvalRun[] {
  const real = runs.filter((r) =>
    r.adapter === "claude"
    && (model === undefined || r.model === model)
    && (promptHash === undefined || r.promptHash === promptHash));
  // Different commands imply different system prompts, so a table uses only the latest invocation.
  // Skipped rows have no invocation and remain as report failures.
  const sentInvocations = real.filter((r) => r.skipped === undefined).map((r) => r.invocation);
  const latest = sentInvocations[sentInvocations.length - 1];
  const sameCall = latest === undefined
    ? real
    : real.filter((r) => r.skipped !== undefined || r.invocation === latest);
  // A later sent combination supersedes its earlier skipped row.
  const sentTargets = new Set(sameCall.filter((r) => r.skipped === undefined).map((r) => r.target));
  const kept = sameCall.filter((r) => r.skipped === undefined || !sentTargets.has(r.target));
  // A marked rescored row replaces its original; two unmarked sent rows remain distinct runs.
  const rescoredKeys = new Set(kept.filter((r) => r.rescored !== undefined).map(runKey));
  return kept.filter((r) => r.rescored !== undefined || !rescoredKeys.has(runKey(r)));
}

function runKey(run: EvalRun): string {
  return [run.target, run.repeat, run.promptHash, run.invocation].join("\u0000");
}

/** Grouping that preserves first key appearance and is shared by all three tables. */
function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

export function buildRows(runs: EvalRun[]): Row[] {
  const groups = group(runs, groupKey);
  return [...groups.keys()].sort().map((key) => {
    const sent = (groups.get(key) ?? []).filter((r) => r.skipped === undefined);
    const [klass, input, inputVariant] = key.split("\u0000");
    return {
      class: klass ?? "",
      input: input ?? "",
      inputVariant: inputVariant ?? "",
      s1: fixed(mean(sent.map((r) => r.s1 ?? Number.NaN)), SCORE_DIGITS),
      s2: fixed(mean(sent.map((r) => r.s2 ?? Number.NaN)), SCORE_DIGITS),
      s3: fixed(mean(sent.map((r) => r.s3 ?? Number.NaN)), SCORE_DIGITS),
      // Count cache writes only so repeated reads do not replace first-input cost with the session prefix.
      inputTokensP50: integer(percentile(
        sent.filter((r) => r.cacheCreation > 0).map((r) => r.inputTokens + r.cacheCreation), 50)),
      costP50: fixed(percentile(sent.map((r) => r.costUsd ?? Number.NaN), 50), COST_DIGITS),
      latencyP50: integer(percentile(sent.map((r) => r.ms.llm ?? Number.NaN), 50)),
    };
  });
}

/** S1 zero is inherent to raw and MCP inputs; the sample section explains it once per report. */
export const S1_INPUT_CAUSE = "is a property of this input (see Sample size and limitations)";
export const S1_INPUT_RETRY = "the input carries tokensUsed (compact design context)";
export const S1_INPUT_NOTE = "S1 on raw and mcp inputs is a property of the input,"
  + " not a defect of the run";

/** One failure from a run row; equal `kind` and `tail` values fold repeats into one entry. */
interface Part { item: string; kind: string; value: string; tail: string; retry: string; repeat: number }

function failureParts(runs: EvalRun[], thresholds: Thresholds): Part[] {
  const out: Part[] = [];
  for (const run of runs) {
    const add = (kind: string, value: string, tail: string, retry: string): void => {
      out.push({ item: run.target, kind, value, tail, retry, repeat: run.repeat });
    };
    if (run.skipped !== undefined) {
      add(run.skipped, `est ${String(run.estTokens)} tokens`, "",
        run.skipped === "MAX_INPUT_TOKENS" ? "maxInputTokens raised or design context shrinks" : "budget raised");
    }
    if (run.error !== undefined) add("adapter error:", run.error, "", "adapter recovers");
    if (run.skipped !== undefined) continue;
    if ((run.s1 ?? Number.NaN) < thresholds.s1) {
      if (namesTokens(run)) {
        add("S1", fixed(run.s1 ?? null, RATE_DIGITS),
          `below threshold ${fixed(thresholds.s1, RATE_DIGITS)} (a var(--x) is absent from tokens.css)`,
          "design context names every token sub-property the CSS needs");
      } else add("S1", "0", S1_INPUT_CAUSE, S1_INPUT_RETRY);
    }
    if ((run.s2 ?? Number.NaN) < thresholds.s2) {
      add("S2", fixed(run.s2 ?? null, RATE_DIGITS),
        `below threshold ${fixed(thresholds.s2, RATE_DIGITS)}`, "prompt or emitter changes");
    }
  }
  return out;
}

/** Emits one row per target and lists values with `r<n>` so repeats do not duplicate rows (SPEC 9.6). */
export function buildFailures(runs: EvalRun[], thresholds: Thresholds): Failure[] {
  return [...group(failureParts(runs, thresholds), (p) => p.item)].map(([item, parts]) => ({
    item,
    mode: [...group(parts, (p) => `${p.kind}\u0000${p.tail}`).values()].map((g) => [
      g[0]?.kind ?? "", g.map((p) => p.value).join(", "), g[0]?.tail ?? "",
      `(${g.map((p) => `r${String(p.repeat)}`).join(", ")})`,
    ].filter((cell) => cell !== "").join(" ")).join("; "),
    retryWhen: [...new Set(parts.map((p) => p.retry))].join("; "),
  }));
}

export function buildFixedCosts(runs: EvalRun[]): FixedCost[] {
  const byInput = group(runs.filter((r) => r.skipped === undefined), (r) => r.input);
  return [...byInput.keys()].sort().map((input) => {
    const lines = byInput.get(input) ?? [];
    return {
      input,
      // Session fixed cost is the reused cache_read prefix; each component adds cache_creation plus input_tokens.
      sessionSchemaTokens: integer(percentile(lines.map((r) => r.cacheRead), 50)),
      tokensPerComponentP50: integer(percentile(lines.map((r) => r.inputTokens + r.cacheCreation), 50)),
    };
  });
}

interface McpCounts {
  runs: number;
  sets: number;
  repeats: number;
}

/** Counts sent MCP rows only; skipped rows never invoked the adapter or used a capture. */
function mcpCounts(runs: EvalRun[]): McpCounts {
  const sent = runs.filter((r) => r.input === "mcp" && r.skipped === undefined);
  return {
    runs: sent.length,
    sets: new Set(sent.map((r) => r.target)).size,
    repeats: new Set(sent.map((r) => r.repeat)).size,
  };
}

/** Builds SPEC 9.6 `mcp captures <n>/<sets>` entirely from run rows. */
export function buildMcpCaptures(runs: EvalRun[]): string {
  const mcp = mcpCounts(runs);
  return `${String(mcp.runs)}/${String(mcp.sets)}`;
}

export function buildSampleNotes(runs: EvalRun[]): string[] {
  const sent = runs.filter((r) => r.skipped === undefined);
  const skipped = runs.filter((r) => r.skipped !== undefined);
  const cost = sent.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const mcp = mcpCounts(runs);
  return [
    // Count unique combinations rather than rows so retries do not inflate the total.
    `combinations: ${String(new Set(runs.map((r) => r.target)).size)}`,
    `sent: ${String(sent.length)}`,
    `skipped: ${String(skipped.length)}`,
    `total cost usd: ${fixed(cost.length === 0 ? null : cost.reduce((a, b) => a + b, 0), COST_DIGITS)}`,
    `output tokens p50: ${integer(percentile(sent.map((r) => r.outputTokens), 50))}`,
    `mcp captures runs/sets: ${buildMcpCaptures(runs)}`,
    `mcp repeats: ${String(mcp.repeats)}`,
    ...(runs.some((r) => !namesTokens(r)) ? [S1_INPUT_NOTE] : []),
  ];
}
