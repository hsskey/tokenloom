// SPEC 9.3 MCP capture. Preserves tool_result blocks and tools/list verbatim from the
// `claude -p ... --output-format stream-json --verbose --allowedTools "mcp__figma__*"` stream.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_SPAWN_ENV, type ChildOutput, type ChildRun } from "./model-port";

export interface ToolResult {
  toolUseId: string;
  name: string;
  /** Preserved verbatim rather than parsed and serialized again so drift remains detectable. */
  content: unknown;
}

export interface CaptureResult {
  toolResults: ToolResult[];
  toolsList: unknown[];
  /** All observed tool_use blocks, including local tools such as ToolSearch. */
  toolUseCount: number;
  /** Observed `mcp__figma__*` calls; only these consume the monthly Figma allowance. */
  figmaToolUseCount: number;
  serverVersion: string | null;
}

/** Prefix for tools that consume the monthly Figma allowance; ToolSearch does not. */
export const FIGMA_TOOL_PREFIX = "mcp__figma__";

interface StreamLine {
  type?: string;
  subtype?: string;
  tools?: unknown[];
  message?: { content?: unknown[] };
  mcp_servers?: { name?: string; version?: string }[];
}

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  content?: unknown;
}

/**
 * stream-json contains one JSON value per line. Malformed lines are skipped because discarding
 * a whole capture for one parse failure would waste one of the limited monthly captures.
 */
export function parseCaptureStream(stream: string): CaptureResult {
  const toolResults: ToolResult[] = [];
  const names = new Map<string, string>();
  let toolsList: unknown[] = [];
  let toolUseCount = 0;
  let figmaToolUseCount = 0;
  let serverVersion: string | null = null;

  for (const line of stream.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;
    const event = tryParse(trimmed);
    if (event === null) continue;
    if (Array.isArray(event.tools) && event.tools.length > 0) toolsList = event.tools;
    serverVersion ??= versionOf(event);
    for (const raw of event.message?.content ?? []) {
      const block = raw as ContentBlock;
      if (block.type === "tool_use") {
        toolUseCount += 1;
        if (block.name?.startsWith(FIGMA_TOOL_PREFIX) === true) figmaToolUseCount += 1;
        if (block.id !== undefined && block.name !== undefined) names.set(block.id, block.name);
      }
      if (block.type === "tool_result" && block.tool_use_id !== undefined) {
        toolResults.push({
          toolUseId: block.tool_use_id,
          name: names.get(block.tool_use_id) ?? "",
          content: block.content,
        });
      }
    }
  }
  return { toolResults, toolsList, toolUseCount, figmaToolUseCount, serverVersion };
}

function tryParse(line: string): StreamLine | null {
  try {
    return JSON.parse(line) as StreamLine;
  } catch (error) {
    process.stderr.write(`capture: skipped unparsable line (${error instanceof Error ? error.message : "?"})\n`);
    return null;
  }
}

function versionOf(event: StreamLine): string | null {
  for (const server of event.mcp_servers ?? []) {
    if (server.name?.includes("figma") === true && server.version !== undefined) return server.version;
  }
  return null;
}

/** `samples/captures/mcp/<serverVersion>/<nodeId>.json`; falls back to the capture date (SPEC 9.3). */
export function capturePath(serverVersion: string | null, utcDate: string, nodeId: string): string {
  const version = serverVersion ?? utcDate;
  const safeNode = nodeId.replace(/[^A-Za-z0-9_-]+/g, "-");
  return `samples/captures/mcp/${version}/${safeNode}.json`;
}

/**
 * Frozen prompt text. The recorded captures under `samples/captures/mcp/` were produced with these
 * exact bytes, so editing them makes new captures incomparable with the stored ones.
 */
export const CAPTURE_PROMPT =
  "다음 노드에 대해 get_design_context, get_metadata, get_variable_defs를"
  + " 각각 한 번씩 호출하고 결과를 요약하거나 가공하지 말 것";

/**
 * Also frozen, for the same reason as `CAPTURE_PROMPT`. All three tools require `fileKey` (schema
 * observed on 2026-09-03), so a node ID alone cannot locate the node. The text forbids loading
 * skills or resources first: those tools are outside `--allowedTools`, so obeying that prerequisite
 * would consume turns without progress.
 */
export function capturePrompt(fileKey: string, nodeId: string): string {
  return [
    CAPTURE_PROMPT + ".",
    "세 툴 모두 fileKey와 nodeId를 인자로 받는다. 스킬이나 리소스를 먼저 읽지 말고 아래 값으로 바로 호출한다.",
    `url: https://figma.com/design/${fileKey}?node-id=${nodeId.replace(":", "-")}`,
    `fileKey: ${fileKey}`,
    `nodeId: ${nodeId}`,
  ].join("\n");
}

/** Figma calls one capture is expected to make, and the minimum charged to the budget ledger. */
export const CAPTURE_TOOL_CALLS = 3;

/**
 * SPEC 9.3 runaway guard. Allows two spare turns beyond a fully sequential capture: three tool
 * turns and one completion turn. The budget ledger remains the tool-call limit.
 */
export const CAPTURE_MAX_TURNS = 6;

/**
 * Ledger charge. Counts Figma tool calls only because ToolSearch loads schemas locally and does
 * not consume the monthly allowance. Counting all tool_use blocks would overcharge each capture.
 */
export function captureCost(result: CaptureResult): number {
  return Math.max(CAPTURE_TOOL_CALLS, result.figmaToolUseCount);
}

export type CaptureRun = ChildOutput;

/**
 * Builds the SPEC 9.3 command separately so it can be verified without execution.
 * `--strict-mcp-config --mcp-config` exposes only the Figma server to the child. Loading the full
 * local surface cost $0.82 for setup alone in the 2026-09-03 measurement. The server must retain
 * the user-scoped name `figma` so the saved OAuth credentials are reused.
 */
export function captureArgs(prompt: string, maxBudgetUsd: number, mcpConfigPath: string): string[] {
  return [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--strict-mcp-config", "--mcp-config", mcpConfigPath,
    // Capture only stores verbatim tool results, so the cheapest model suffices here. Eval runs are
    // unaffected and keep using the matrix model.
    "--model", CAPTURE_MODEL,
    // ToolSearch lets the child load deferred Figma schemas instead of stopping after its first turn.
    // The argument remains harmless if a smaller tool surface later removes deferred loading.
    "--allowedTools", "mcp__figma__*", "ToolSearch",
    "--max-turns", String(CAPTURE_MAX_TURNS),
    "--max-budget-usd", String(maxBudgetUsd),
  ];
}

/**
 * Checks all seven SPEC 9.3 conditions before capture and returns the failed condition label, or
 * null when every condition holds. The `(a)`-`(g)` labels are the contract SPEC 9.3 and the capture
 * tests refer to. This makes no network or Figma call: it exists because repeated child-environment
 * failures consumed real budget. Tests inject the environment through `env`.
 */
export function preflightCapture(input: {
  args: string[]; cwd: string; repoRoot: string; mcpConfig: { mcpServers?: Record<string, unknown> };
  env?: NodeJS.ProcessEnv;
}): string | null {
  const { args, cwd, repoRoot, mcpConfig, env = process.env } = input;
  const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
  // Running outside the repository keeps its instructions out of the child's system prompt.
  if (cwd === repoRoot || cwd.startsWith(`${repoRoot}/`)) return "(a) neutral cwd outside the repo";
  if (!args.includes("--strict-mcp-config")) return "(b) --strict-mcp-config";
  const servers = Object.keys(mcpConfig.mcpServers ?? {});
  if (servers.length !== 1 || servers[0] !== "figma") return `(b) figma-only mcp config, got [${servers.join(", ")}]`;
  const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--max-turns"));
  if (allowed.join(",") !== `${FIGMA_TOOL_PREFIX}*,ToolSearch`) return `(c) allowed tools, got [${allowed.join(", ")}]`;
  if (after("--model") !== CAPTURE_MODEL) return `(d) cheapest model ${CAPTURE_MODEL}`;
  if (after("--max-turns") !== String(CAPTURE_MAX_TURNS)) return `(e) --max-turns ${CAPTURE_MAX_TURNS}`;
  const budget = Number(after("--max-budget-usd"));
  if (!Number.isFinite(budget) || budget <= 0) return "(f) --max-budget-usd";
  // Checked last but before any ledger charge, so a refusal costs nothing.
  if (env[NO_SPAWN_ENV] !== undefined) return `(g) ${NO_SPAWN_ENV} is set, no child will be spawned`;
  return null;
}

/** Repository-owned child MCP configuration containing only the Figma server. */
export const CAPTURE_MCP_CONFIG = "eval/mcp-figma.json";

/** Cheapest model sufficient to invoke the three capture tools (SPEC 9.3). */
export const CAPTURE_MODEL = "sonnet";

/**
 * Neutral directory outside the repository for the same reason as SPEC 9.2. Repository instructions
 * entered the child system prompt during a 2026-09-03 capture and caused the child to reject the
 * intended Figma call. Preflight and execution must see the same directory, so it is created once.
 */
let cachedCaptureCwd: string | undefined;
export function captureNeutralCwd(): string {
  cachedCaptureCwd ??= mkdtempSync(join(tmpdir(), "tl-capture-"));
  return cachedCaptureCwd;
}

/** Reads the child MCP config; missing or invalid input becomes an empty object that fails preflight (b). */
export function readCaptureMcpConfig(path: string): { mcpServers?: Record<string, unknown> } {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
  } catch {
    return {};
  }
}

/**
 * Executes the SPEC 9.3 command. This package owns the `claude` child so the deterministic CLI path
 * creates no LLM or network process. Tests inject a double through `run`; the default is guarded.
 */
export function runCaptureStream(args: string[], cwd: string, run: ChildRun): Promise<CaptureRun> {
  return run("claude", args, cwd);
}
