// Drives matrix -> prompt -> adapter -> runs/*.jsonl. Controls flow only; every verdict is made by
// score.ts and stats.ts.
import { estimateTokens, pool } from "@tokenloom/schema";
import { combinations, NO_INPUT_VARIANT, targetOf, type MatrixT } from "./matrix";
import { buildMcpPromptInput, buildPromptInput, promptHash, renderPrompt, templateText } from "./prompt";
import type { LlmAdapter } from "./model-port";
import {
  costBasis, outputBasis, readPlanning, readPricing, realRuns,
  type BudgetPlanning, type CostBasis, type OutputBasis, type Rate,
} from "./stats";
import { readTrackedRuns, runsDir, type EvalRun } from "./runs";
import { scoreS1, scoreS2 } from "./score";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** SPEC 9.6 abort ratio for writing a partial report once cumulative usage exceeds the budget. */
export const ABORT_RATIO = 1.1;

export interface PlanningOptions {
  repoRoot: string;
  matrix: MatrixT;
  parallel: number;
  /** Stops dispatch before cumulative cost exceeds this budget by the SPEC 9.6 abort ratio. */
  budgetUsd?: number;
  /** Calculated once by the CLI so run lines and `runs/out/` use the same date. */
  utcDate?: string;
  /** Output-token baseline; defaults to committed runs and accepts injected test rows. */
  basisRuns?: EvalRun[];
  onRecord?: (record: EvalRun) => void;
}

export interface RunOptions extends PlanningOptions {
  adapter: LlmAdapter;
}

export interface RunSummary {
  records: EvalRun[];
  sent: number;
  skipped: number;
  costUsd: number;
  ms: number;
}

export interface InputBreakdown {
  input: string;
  runs: number;
  sendable: number;
  estInputTokens: number;
}

export interface DryRunSummary {
  runs: number;
  sendable: number;
  skipped: number;
  estInputTokens: number;
  /**
   * Estimated input charge. The prompt is a cache write; per-call prefixes and repeated prompts are
   * cache reads. Without pricing or a baseline this is null and only the token total is meaningful.
   */
  estCostUsd: number | null;
  model: string;
  /** Planned prompt hash used to select a baseline and compare earlier runs (SPEC 9.6). */
  promptHash: string;
  /** Baseline p50 times sendable combinations, or null without a baseline. */
  estOutputTokens: number | null;
  estOutputCostUsd: number | null;
  /** Input plus output cost, or null when either component is unavailable. */
  estTotalCostUsd: number | null;
  /** Evidence used for the output estimate. */
  outputBasis: OutputBasis;
  /** Run rows used to derive the input-cost coefficients. */
  costBasis: CostBasis;
  /**
   * Recommended `--budget-usd`: the estimate multiplied by planning headroom from
   * `eval/planning.json`. Kept separate so the estimate itself is not inflated.
   */
  recommendedBudgetUsd: number | null;
  /** Source of the planning headroom. */
  planningBasis: BudgetPlanning | null;
  /** Per-input breakdown used to choose which dimension to reduce. */
  byInput: InputBreakdown[];
}

/** --dry-run summary of run count, estimated input tokens, and pricing cost without calls. */
export function dryRun(options: PlanningOptions): DryRunSummary {
  const planned = plan(options, "fake");
  const sendable = planned.filter((p) => p.record.skipped === undefined);
  const estInputTokens = sendable.reduce((sum, p) => sum + p.record.estTokens, 0);
  const pricing = readPricing(options.repoRoot);
  const rate = pricing?.models[options.matrix.model];
  const usd = (tokens: number | null, perMTok: number | undefined): number | null =>
    tokens === null || perMTok === undefined ? null : Number(((tokens / 1_000_000) * perMTok).toFixed(4));
  const hash = promptHash(templateText(options.repoRoot));
  // Apply report replacement rules so rescored copies do not inflate the baseline (SPEC 9.6).
  const lines = realRuns(options.basisRuns ?? readTrackedRuns(options.repoRoot));
  const basis = outputBasis(lines, options.matrix.model, hash);
  const cost = costBasis(lines, options.matrix.model, hash);
  const avg = basis.outputTokensMean;
  const estOutputTokens = avg === null ? null : Math.round(avg * sendable.length);
  const estCostUsd = inputUsd(sendable, cost, rate);
  const estOutputCostUsd = usd(estOutputTokens, rate?.outputPerMTok);
  const planning = readPlanning(options.repoRoot)?.budget ?? null;
  const estTotalCostUsd = estCostUsd === null || estOutputCostUsd === null
    ? null
    : Number((estCostUsd + estOutputCostUsd).toFixed(4));
  return {
    runs: planned.length,
    sendable: sendable.length,
    skipped: planned.length - sendable.length,
    estInputTokens,
    estCostUsd,
    model: options.matrix.model,
    promptHash: hash,
    estOutputTokens,
    estOutputCostUsd,
    estTotalCostUsd,
    outputBasis: basis,
    costBasis: cost,
    recommendedBudgetUsd: estTotalCostUsd === null || planning === null
      ? null
      : Number((estTotalCostUsd * planning.factor).toFixed(4)),
    planningBasis: planning,
    byInput: breakdown(planned),
  };
}

/**
 * Input charge for planned rows. A repeated prompt is written once and read thereafter, so the
 * billing unit is the distinct prompt rather than the combination count.
 */
function inputUsd(sendable: Planned[], basis: CostBasis, rate: Rate | undefined): number | null {
  const { ratio, overhead, cacheReadPerCall } = basis;
  if (rate === undefined || ratio === null || overhead === null || cacheReadPerCall === null) return null;
  const written = new Set<string>();
  let perMTok = 0;
  for (const item of sendable) {
    const key = promptHash(item.prompt);
    const prompt = ratio * item.record.estTokens + overhead;
    const first = !written.has(key);
    written.add(key);
    perMTok += first
      ? prompt * rate.cacheWrite1hPerMTok + cacheReadPerCall * rate.cacheReadPerMTok
      : (prompt + cacheReadPerCall) * rate.cacheReadPerMTok;
  }
  return Number((perMTok / 1_000_000).toFixed(4));
}

/** Groups by the literal matrix `inputs` values in input-name order. */
function breakdown(planned: Planned[]): InputBreakdown[] {
  const names = [...new Set(planned.map((p) => p.record.input))].sort();
  return names.map((input) => {
    const rows = planned.filter((p) => p.record.input === input);
    const sendable = rows.filter((p) => p.record.skipped === undefined);
    return {
      input,
      runs: rows.length,
      sendable: sendable.length,
      estInputTokens: sendable.reduce((sum, p) => sum + p.record.estTokens, 0),
    };
  });
}

interface Planned {
  record: EvalRun;
  prompt: string;
}

/** Separates sendable and oversized inputs up front; an oversized input is a result, not a failure. */
export function plan(options: PlanningOptions, adapterKind: LlmAdapter["kind"]): Planned[] {
  const template = templateText(options.repoRoot);
  const hash = promptHash(template);
  return combinations(options.matrix).map((combo) => {
    const input = combo.inputVariant === NO_INPUT_VARIANT
      ? buildMcpPromptInput(options.repoRoot, combo.sampleName, combo.node)
      : buildPromptInput(options.repoRoot, combo.sampleName, combo.inputVariant, combo.node);
    const prompt = renderPrompt(template, input);
    const bytesIn = Buffer.byteLength(prompt, "utf8");
    const estTokens = estimateTokens(bytesIn);
    const record: EvalRun = {
      cmd: "eval",
      target: targetOf(combo),
      utcDate: options.utcDate ?? "",
      sampleName: combo.sampleName,
      inputVariant: combo.inputVariant,
      input: combo.input,
      repeat: combo.repeat,
      adapter: adapterKind,
      model: options.matrix.model,
      invocation: "",
      promptHash: hash,
      bytesIn,
      bytesOut: 0,
      ratio: 0,
      estTokens,
      inputTokens: 0,
      cacheCreation: 0,
      cacheRead: 0,
      outputTokens: 0,
      costUsd: null,
      ms: {},
      warnings: 0,
    };
    if (estTokens > options.matrix.maxInputTokens) {
      record.skipped = "MAX_INPUT_TOKENS";
    }
    return { record, prompt };
  });
}

async function send(planned: Planned, adapter: LlmAdapter, model: string, repoRoot: string): Promise<void> {
  const result = await adapter.run(planned.prompt, { sampleName: planned.record.sampleName, model, repoRoot });
  const record = planned.record;
  record.bytesOut = Buffer.byteLength(result.text, "utf8");
  record.ratio = record.bytesOut === 0 ? 0 : Number((record.bytesIn / record.bytesOut).toFixed(2));
  record.inputTokens = result.inputTokens;
  record.cacheCreation = result.cacheCreation;
  record.cacheRead = result.cacheRead;
  record.outputTokens = result.outputTokens;
  record.costUsd = result.costUsd;
  record.model = result.model;
  record.invocation = result.invocation;
  record.ms = { llm: result.ms };
  if (result.error !== undefined) record.error = result.error;
  const tokensCss = readTokensCss(repoRoot, record.sampleName);
  record.s1 = scoreS1(result.text, tokensCss);
  record.s2 = Number(scoreS2(result.text).toFixed(4));
  // S3 is computed only for samples with rendered PNGs; absence produces null.
  record.s3 = null;
  writeOutput(repoRoot, record, result.text);
}

/**
 * Preserves the raw response under the gitignored local `runsDir`. It is not report input, but lets
 * S1 failures be diagnosed without paying for another call.
 */
export function writeOutput(repoRoot: string, record: EvalRun, text: string): string {
  const safe = record.target.replace(/[^A-Za-z0-9_.-]+/g, "-");
  const path = join(runsDir(repoRoot), "out", record.utcDate, `${safe}.r${record.repeat}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/** An empty file is a measurement with zero names; null means the file does not exist. */
function readTokensCss(repoRoot: string, sampleName: string): string | null {
  const path = resolve(repoRoot, "samples", sampleName, "reference/css/tokens.css");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * The real adapter sends one warmup call so the system prompt enters cache before parallel work.
 * Measured cost was $0.3408 cold and $0.0171 warm; six concurrent first calls were all cold.
 */
export async function runMatrix(options: RunOptions): Promise<RunSummary> {
  const adapter = options.adapter;
  const planned = plan(options, adapter.kind);
  const started = Date.now();
  const sendable = planned.filter((p) => p.record.skipped === undefined);
  const abortAt = options.budgetUsd === undefined ? undefined : options.budgetUsd * ABORT_RATIO;
  let cost = 0;
  let inFlight = 0;
  let perRun = 0;

  const dispatch = async (item: Planned): Promise<void> => {
    // Include in-flight calls so parallelism cannot overspend before completed results are checked.
    if (abortAt !== undefined && cost + perRun * (inFlight + 1) > abortAt) {
      item.record.skipped = "BUDGET_STOP";
      return;
    }
    inFlight += 1;
    try {
      await send(item, adapter, options.matrix.model, options.repoRoot);
    } finally {
      inFlight -= 1;
    }
    const spent = item.record.costUsd ?? 0;
    cost += spent;
    perRun = Math.max(perRun, spent);
    options.onRecord?.(item.record);
  };

  // Only the real adapter needs cache warmup; fake calls remain fully parallel.
  const warmup = adapter.kind === "claude" ? sendable.slice(0, 1) : [];
  const rest = sendable.slice(warmup.length);
  for (const item of warmup) await dispatch(item);
  await pool(rest, options.parallel, dispatch);

  const records = planned.map((p) => p.record);
  return {
    records,
    sent: records.filter((r) => r.skipped === undefined).length,
    skipped: records.filter((r) => r.skipped !== undefined).length,
    costUsd: Number(cost.toFixed(4)),
    ms: Date.now() - started,
  };
}
