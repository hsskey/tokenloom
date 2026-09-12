// Keep this command at the routing and validation boundary; A10 keeps every measurement in @tokenloom/eval.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { stableJsonFile } from "@tokenloom/schema";
import {
  createClaudeSessionAdapter, createCliToolPort, createMcpToolPort, fakeAdapter, loadTrajectoryMatrix, planTrajectory,
  readPricing, readTrajectoryRuns, realRun, renderTrajectoryReport, runTrajectory, selectAdapter,
} from "@tokenloom/eval";
import { EXIT, flagBool, flagString, usageError, type Parsed } from "./args";
import { repoRoot } from "./runs";

export async function cmdEvalTrajectory(parsed: Parsed): Promise<number> {
  const matrixPath = flagString(parsed, "matrix");
  if (matrixPath === undefined) return usageError("eval trajectory: --matrix <yaml> is required");
  if (parsed.flags["budget-usd"] === true) return usageError("eval trajectory: --budget-usd requires a value");
  const budgetRaw = flagString(parsed, "budget-usd");
  const budgetUsd = budgetRaw === undefined ? undefined : Number(budgetRaw);
  if (budgetUsd !== undefined && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) {
    return usageError(`eval trajectory: --budget-usd ${budgetRaw} is not a positive number`);
  }
  const root = repoRoot(process.cwd());
  const matrixFile = resolve(root, matrixPath);
  if (!existsSync(matrixFile)) return usageError(`eval trajectory: --matrix ${matrixPath} does not exist`);
  const matrixConfig = loadTrajectoryMatrix(matrixFile);
  if (budgetUsd !== undefined && budgetUsd > matrixConfig.budgetUsd) {
    return usageError(`eval trajectory: --budget-usd ${budgetRaw} exceeds matrix budgetUsd ${matrixConfig.budgetUsd}`);
  }
  const matrix = { ...matrixConfig, ...(budgetUsd === undefined ? {} : { budgetUsd }) };

  // A dry run never invokes a model, so it needs neither an adapter nor provider pricing.
  if (flagBool(parsed, "dry-run")) {
    const plan = planTrajectory(matrix);
    process.stderr.write(`eval trajectory dry-run: ${plan.runs} runs, ${plan.estInputTokens} est input tokens\n`);
    if (flagBool(parsed, "json")) process.stdout.write(stableJsonFile(plan));
    return EXIT.ok;
  }

  const source = budgetUsd === undefined ? "matrix budgetUsd" : "--budget-usd";
  process.stderr.write(`eval trajectory: budget $${matrix.budgetUsd.toFixed(4)} (${source})\n`);
  const adapter = selectAdapter();
  const set = await runTrajectory({
    repoRoot: root, matrix, utcDate: new Date().toISOString().slice(0, 10), child: realRun,
    rate: adapter.kind === "fake" ? null : readPricing(root)?.models[matrix.model] ?? null,
    makeAdapter: (bound) => adapter.kind === "fake" ? fakeAdapter : createClaudeSessionAdapter(bound),
    toolPortFor: (condition) => condition === "mcp-agent" ? createMcpToolPort(root) : createCliToolPort(root),
  });
  const report = renderTrajectoryReport(readTrajectoryRuns(root));
  process.stderr.write(`eval trajectory: ${set.records.length} runs, $${set.costUsd.toFixed(4)} -> ${set.path}\n`);
  const summary = { runs: set.records.length, costUsd: set.costUsd, stopped: set.stopped, path: set.path, report };
  process.stdout.write(flagBool(parsed, "json") ? stableJsonFile(summary) : report);
  return set.stopped === null && !set.records.some((run) => run.error !== undefined) ? EXIT.ok : EXIT.network;
}
