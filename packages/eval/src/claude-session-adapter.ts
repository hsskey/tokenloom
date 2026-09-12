// T802 concrete session adapter; `realRun` remains the only process boundary.
import { join } from "node:path";
import { realRun } from "./child";
import { createClaudeAdapter } from "./adapter";
import type { ChildRunWithStdin, ToolPort, ToolRequest, ToolResponse } from "./agent-session-port";
import type { ChildRun, LlmAdapter } from "./model-port";

export const CLAUDE_SESSION_KIND = "claude";
/** Records the real command shape: a per-call provider budget is not the section 9.2 invocation. */
export const CLAUDE_SESSION_INVOCATION = "claude -p --output-format json --restricted --model <id> --max-budget-usd <bound>";
const [BUDGET_DIGITS, INIT_ID, CALL_ID] = [4, 1, 2];
const [CLI_PATH, MCP_ENTRY, TSX_PATH] = ["apps/cli/dist/tokenloom.js", "packages/mcp/src/index.ts", "node_modules/.bin/tsx"];
const PROTOCOL_VERSION = "2024-11-05";
const MISSING_USAGE = "MISSING_AUTHORITATIVE_USAGE";
const USAGE_KEYS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"];
const validToken = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const validCost = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The provider and harness enforce the same dollar bound; this Claude version has no output-token flag. */
export function createClaudeSessionAdapter(perCallBudgetUsd: number, run: ChildRunWithStdin = realRun): LlmAdapter {
  const scale = 10 ** BUDGET_DIGITS;
  const providerBudgetUsd = Math.trunc(perCallBudgetUsd * scale) / scale;
  let usageComplete = true;
  const capped: ChildRun = async (cmd, args, cwd) => {
    const res = await run(cmd, [...args, "--max-budget-usd", providerBudgetUsd.toFixed(BUDGET_DIGITS)], cwd);
    if (res.code !== 0 || res.stdout.trim() === "") { usageComplete = false; return res; }
    const body = JSON.parse(res.stdout) as { total_cost_usd?: unknown; usage?: Record<string, unknown> };
    usageComplete = USAGE_KEYS.every((key) => validToken(body.usage?.[key]));
    for (const key of USAGE_KEYS) if (!validToken(body.usage?.[key])) delete body.usage?.[key];
    if (!validCost(body.total_cost_usd)) delete body.total_cost_usd;
    return { ...res, stdout: JSON.stringify(body) };
  };
  const inner = createClaudeAdapter(capped);
  return {
    kind: "claude",
    run: async (prompt, context) => {
      usageComplete = true;
      const result = await inner.run(prompt, context);
      // Keep the child diagnostic behind the code so a stop stays readable once the child is gone.
      const missing = result.error === undefined ? MISSING_USAGE : `${MISSING_USAGE}: ${result.error}`;
      return { ...result, invocation: CLAUDE_SESSION_INVOCATION, ...(usageComplete ? {} : { error: missing }) };
    },
  };
}

/** `key=value` keeping every later `=`, so a selector such as `variant=size=md` survives the split. */
function pairs(request: ToolRequest): [string, string][] {
  return request.args.map((arg) => {
    const eq = arg.indexOf("=");
    return eq < 0 ? [arg, ""] : [arg.slice(0, eq), arg.slice(eq + 1)];
  });
}

/** Runs the built CLI as a child. A canonical diagnostic is on stderr, so both streams are returned whole. */
export function createCliToolPort(repoRoot: string, run: ChildRunWithStdin = realRun): ToolPort {
  return {
    kind: "cli",
    call: async (request) => {
      const kv = pairs(request);
      // The CLI takes the component set as a positional argument and everything else as a long option.
      const component = kv.find(([key]) => key === "component")?.[1];
      const options = kv.filter(([key]) => key !== "component").map(([key, value]) => `--${key}=${value}`);
      const argv = [request.tool, ...(component === undefined ? [] : [component]), ...options, "--json"];
      const res = await run(process.execPath, [join(repoRoot, CLI_PATH), ...argv], repoRoot);
      return { content: res.stdout, stderr: res.stderr, exitCode: res.code };
    },
  };
}

function rpcLines(request: ToolRequest): string {
  const args = Object.fromEntries(pairs(request));
  const client = { name: "tokenloom-eval", version: "0" };
  return [
    { jsonrpc: "2.0", id: INIT_ID, method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: client } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: CALL_ID, method: "tools/call", params: { name: request.tool, arguments: args } },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n";
}

interface RpcReply { id?: number; result?: { content?: unknown; isError?: boolean }; error?: unknown }

function replyOf(stdout: string): RpcReply | undefined {
  for (const line of stdout.split("\n").filter((l) => l.trim() !== "")) {
    try {
      const message = JSON.parse(line) as RpcReply;
      if (message.id === CALL_ID) return message;
    } catch { continue; }
  }
  return undefined;
}

function contentOf(reply: RpcReply): string | null {
  const content = reply.result?.content;
  if ("error" in reply || !Array.isArray(content)
    || content.some((part) => typeof part !== "object" || part === null || typeof part.text !== "string")) return null;
  return content.map((part) => part.text as string).join("");
}

/**
 * Runs the MCP server as a stdio child instead of importing it, so the evaluation package measures the MCP
 * interface without depending on that package. Every request is written before stdin closes and the server
 * ends with that stream, which keeps one session inside one `ChildRun` call.
 */
export function createMcpToolPort(repoRoot: string, run: ChildRunWithStdin = realRun): ToolPort {
  const at = (rel: string): string => JSON.stringify(join(repoRoot, rel));
  const launch = `import(${at(MCP_ENTRY)}).then((m) => m.serve(m.nodeCli(${at(CLI_PATH)}, ${JSON.stringify(repoRoot)})));`;
  return {
    kind: "mcp",
    call: async (request): Promise<ToolResponse> => {
      const res = await run(join(repoRoot, TSX_PATH), ["-e", launch], repoRoot, rpcLines(request));
      const reply = replyOf(res.stdout);
      const content = reply === undefined ? null : contentOf(reply);
      if (content === null) return {
        content: reply?.error === undefined ? "" : JSON.stringify(reply.error),
        stderr: res.stderr, exitCode: res.code === 0 ? 1 : res.code,
      };
      return {
        content, stderr: res.stderr,
        exitCode: res.code !== 0 ? res.code : reply?.result?.isError === true ? 1 : 0,
      };
    },
  };
}
