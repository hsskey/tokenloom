// docs/reference/spec.md section 9.3: Reserve MCP calls against the plan's budget windows before
// capture (docs/reference/spec.md section 4.10).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stableJsonFile } from "@tokenloom/schema";
import {
  CAPTURE_MCP_CONFIG, CAPTURE_TOOL_CALLS, captureArgs, captureNeutralCwd, capturePath, capturePrompt, captureCost,
  NO_SPAWN_ENV, parseCaptureStream, preflightCapture, readCaptureMcpConfig, realRun, runCaptureStream, SpawnRefusedError,
} from "@tokenloom/eval";
import { createFileBudget, tightest, type BudgetConfig } from "@tokenloom/rest";
import config from "../../../tokenloom.config";
import { EXIT, flagBool, flagString, usageError, type Parsed } from "./args";
import { appendRun, repoRoot } from "./runs";

const BUDGET_CONFIG: BudgetConfig = config.budget;

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Preserve the child stream so failed captures can be diagnosed without another paid capture. */
function writeStream(root: string, nodeId: string, stream: string): string {
  const dir = join(process.env.TOKENLOOM_RUNS_DIR ?? join(root, "runs"), "out", utcDate());
  mkdirSync(dir, { recursive: true });
  // Timestamp each attempt so a retry cannot overwrite evidence needed for budget reconciliation.

  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const path = join(dir, `capture-${nodeId.replace(/[^A-Za-z0-9_-]+/g, "-")}-${stamp}.stream.jsonl`);
  writeFileSync(path, stream, "utf8");
  return path;
}

export async function cmdEvalCapture(parsed: Parsed): Promise<number> {
  if (flagString(parsed, "input") !== "mcp") return usageError("eval capture: --input mcp is required");
  const nodeId = flagString(parsed, "node");
  if (nodeId === undefined) return usageError("eval capture: --node <id> is required");
  // Every capture tool needs fileKey; a node ID alone cannot locate the node.
  const fileKey = flagString(parsed, "file");
  if (fileKey === undefined) return usageError("eval capture: --file <key> is required");

  const root = repoRoot(process.cwd());
  const created = createFileBudget(root, config.plan, BUDGET_CONFIG, Date.now);
  if (!created.ok) {
    process.stderr.write(`eval capture: ${created.reason}\n`);
    return EXIT.network;
  }
  // Preflight runs before reservation so invalid environments need no budget rollback (docs/reference/spec.md section 9.3).

  const mcpConfigPath = join(root, CAPTURE_MCP_CONFIG);
  const args = captureArgs(capturePrompt(fileKey, nodeId), config.captureMaxBudgetUsd, mcpConfigPath);
  const cwd = captureNeutralCwd();
  const violated = preflightCapture({ args, cwd, repoRoot: root, mcpConfig: readCaptureMcpConfig(mcpConfigPath) });
  if (violated !== null) {
    process.stderr.write(`eval capture: preflight failed ${violated}\n`);
    return EXIT.fatal;
  }

  // Reserve the documented capture tool-call allowance only after preflight succeeds.
  const denied = created.budget.spend("mcp", CAPTURE_TOOL_CALLS);
  if (denied !== null) {
    process.stderr.write(`eval capture: mcp budget exhausted ${JSON.stringify(denied)}\n`);
    return EXIT.network;
  }

  const started = performance.now();
  // Distinguish process refusal from budget exhaustion even when the budget permits capture.
  let stream;
  try {
    stream = await runCaptureStream(args, cwd, realRun);
  } catch (error) {
    if (!(error instanceof SpawnRefusedError)) throw error;
    process.stderr.write(`eval capture: spawn refused, ${NO_SPAWN_ENV} is set\n`);
    return EXIT.fatal;
  }
  // Save the original stream before parsing so failures remain diagnosable without another capture.
  const streamPath = writeStream(root, nodeId, stream.stdout);
  process.stderr.write(`eval capture: raw stream -> ${streamPath}\n`);
  if (stream.code !== 0 && stream.stdout.trim() === "") {
    process.stderr.write(`eval capture: claude failed ${stream.stderr.slice(-300)}\n`);
    return EXIT.network;
  }

  const result = parseCaptureStream(stream.stdout);
  // Reconcile any observed tool calls beyond the reserved allowance.
  const extra = captureCost(result) - CAPTURE_TOOL_CALLS;
  if (extra > 0) created.budget.spend("mcp", extra);

  const rel = capturePath(result.serverVersion, utcDate(), nodeId);
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableJsonFile({
    nodeId,
    serverVersion: result.serverVersion,
    toolsList: result.toolsList,
    toolResults: result.toolResults,
  }));

  // The tightest window determines whether the next capture can proceed.
  const mcpWindow = tightest(created.budget.current(), "mcp");
  process.stderr.write(
    `eval capture: ${result.toolResults.length} tool results -> ${rel}`
    + ` (figma tool_use ${result.figmaToolUseCount},`
    + ` mcp per ${mcpWindow?.per ?? "none"} ${mcpWindow?.used ?? 0}/${mcpWindow?.cap ?? 0})\n`,
  );
  if (flagBool(parsed, "json")) {
    process.stdout.write(stableJsonFile({
      path: rel,
      toolResults: result.toolResults.length,
      toolUseCount: result.toolUseCount,
      figmaToolUseCount: result.figmaToolUseCount,
      streamPath,
      budget: { mcpUsed: mcpWindow?.used ?? 0, mcpCap: mcpWindow?.cap ?? 0, mcpPer: mcpWindow?.per ?? null },
    }));
  }
  appendRun({
    cmd: "eval capture", target: nodeId,
    bytesIn: 0, bytesOut: Buffer.byteLength(stream.stdout, "utf8"),
    ms: { capture: Math.round(performance.now() - started) }, warnings: 0,
  });
  return EXIT.ok;
}
