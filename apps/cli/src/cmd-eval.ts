import { stableJsonFile } from "@tokenloom/schema";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  appendRuns, buildFixedCosts, buildFailures, buildMcpCaptures, buildRows, buildSampleNotes,
  dryRun, loadMatrix, promptHashes, readPricing, readRuns, readThresholds, realRuns,
  renderReports, runMatrix, selectAdapter,
  type DryRunSummary,
} from "@tokenloom/eval";
import { EXIT, flagBool, flagString, usageError, type Parsed } from "./args";
import { repoRoot } from "./runs";

const DEFAULT_PARALLEL = 6;

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Report the planned budget and its basis on stderr so the recommendation is traceable. */
function recommendedBudget(plan: DryRunSummary): number | undefined {
  if (plan.recommendedBudgetUsd === null || plan.planningBasis === null) return undefined;
  process.stderr.write(
    `eval: --budget-usd not given, using $${plan.recommendedBudgetUsd.toFixed(4)}`
    + ` (estTotalCostUsd $${(plan.estTotalCostUsd ?? 0).toFixed(4)} x ${plan.planningBasis.factor},`
    + ` ${plan.planningBasis.reason})\n`,
  );
  return plan.recommendedBudgetUsd;
}

export async function cmdEvalRun(parsed: Parsed): Promise<number> {
  const matrixPath = flagString(parsed, "matrix");
  if (matrixPath === undefined) return usageError("eval run: --matrix <yaml> is required");
  const budgetRaw = flagString(parsed, "budget-usd");
  const budgetUsd = budgetRaw === undefined ? undefined : Number(budgetRaw);
  if (budgetRaw !== undefined && !Number.isFinite(budgetUsd)) {
    return usageError(`eval run: --budget-usd ${budgetRaw} is not a number`);
  }
  const root = repoRoot(process.cwd());
  const matrix = loadMatrix(matrixPath, root);

  // A dry run never invokes a model or requires a budget, regardless of the environment.
  if (flagBool(parsed, "dry-run")) {
    const summary = dryRun({ repoRoot: root, matrix, parallel: DEFAULT_PARALLEL });
    process.stderr.write(
      `eval dry-run: ${summary.sendable}/${summary.runs} sendable, ${summary.estInputTokens} est input tokens\n`,
    );
    if (flagBool(parsed, "json")) process.stdout.write(stableJsonFile(summary));
    return EXIT.ok;
  }

  const adapter = selectAdapter();
  // Reuse one plan so the recommended budget and preflight refusal use the same estimate.
  const plan = dryRun({ repoRoot: root, matrix, parallel: DEFAULT_PARALLEL });
  // Without an explicit budget, require a recommendation before any real call (docs/reference/spec.md section 9.6).
  const budget = budgetUsd ?? recommendedBudget(plan);
  if (adapter.kind === "claude" && budget === undefined) {
    return usageError("eval run: --budget-usd is required (eval/pricing.json, eval/planning.json, or a cost basis is missing)");
  }
  // Refuse explicit budgets below the available total estimate before the first call (docs/reference/spec.md section 9.6).
  // The recommended default includes planning headroom; refusal uses the budget-exhaustion exit code.
  const est = plan.estTotalCostUsd;
  if (adapter.kind === "claude" && budgetUsd !== undefined && est !== null && budgetUsd < est) {
    process.stderr.write(
      `eval run: --budget-usd $${budgetUsd.toFixed(4)} is below the plan's estTotalCostUsd $${est.toFixed(4)};`
      + " refusing before the first call\n",
    );
    return EXIT.network;
  }
  const parallelRaw = flagString(parsed, "parallel");
  const date = utcDate();
  const summary = await runMatrix({
    repoRoot: root,
    matrix,
    parallel: parallelRaw === undefined ? DEFAULT_PARALLEL : Number(parallelRaw),
    adapter,
    budgetUsd: budget,
    utcDate: date,
  });
  const path = appendRuns(root, date, summary.records);

  process.stderr.write(
    `eval: ${summary.sent} sent, ${summary.skipped} skipped, $${summary.costUsd.toFixed(4)}, ${summary.ms}ms -> ${path}\n`,
  );
  if (flagBool(parsed, "json")) {
    process.stdout.write(stableJsonFile({
      runs: summary.records.length,
      sent: summary.sent,
      skipped: summary.skipped,
      costUsd: summary.costUsd,
      adapter: adapter.kind,
      model: matrix.model,
      ms: summary.ms,
    }));
  }
  return summary.records.some((r) => r.error !== undefined) ? EXIT.network : EXIT.ok;
}

/** docs/reference/spec.md section 9.6: Report measurements come exclusively from actual run records in runs/*.jsonl. */
export function cmdEvalReport(parsed: Parsed): number {
  const out = flagString(parsed, "out");
  if (out === undefined) return usageError("eval report: --out reports/<date>.md is required");
  const root = repoRoot(process.cwd());
  const since = flagString(parsed, "since");
  const all = readRuns(root).filter((r) => since === undefined || r.utcDate >= since);
  // Prompt hashes distinguish same-day evaluation sets that --since cannot separate (docs/reference/spec.md section 9.6).
  const hash = flagString(parsed, "prompt-hash");
  // Without a selected hash, keep separate sections so one header cannot describe mixed prompts.
  const sections = (hash === undefined ? promptHashes(all) : [hash])
    .map((h) => realRuns(all, undefined, h)).filter((s) => s.length > 0);
  if (sections.length === 0) {
    return usageError(`eval report: no real (adapter=claude) runs${hash === undefined ? "" : ` with promptHash ${hash}`} in runs/*.jsonl`);
  }

  const thresholds = readThresholds(root);
  const pricing = readPricing(root);
  const body = renderReports(sections.map((real) => {
    const first = real[0];
    return {
      date: utcDate(),
      model: modelText(first?.model ?? "unknown", pricing),
      promptHash: first?.promptHash ?? "unknown",
      mcpCaptures: buildMcpCaptures(real),
      rows: buildRows(real),
      failures: buildFailures(real, thresholds),
      fixedCosts: buildFixedCosts(real),
      sampleNotes: buildSampleNotes(real),
    };
  }));
  const runs = sections.reduce((n, real) => n + real.length, 0);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  process.stderr.write(`eval report: ${runs} runs in ${sections.length} sections -> ${out}\n`);
  if (flagBool(parsed, "json")) process.stdout.write(stableJsonFile({ out, runs, sections: sections.length }));
  return EXIT.ok;
}

/** Report model aliases and the pricing-file mapping without presenting billed IDs as measured data. */
function modelText(alias: string, pricing: ReturnType<typeof readPricing>): string {
  const resolved = pricing?.models[alias]?.resolvedModel;
  return resolved === undefined
    ? alias
    : `${alias} (alias; eval/pricing.json resolvedModel ${resolved}; id not recorded in run lines)`;
}
