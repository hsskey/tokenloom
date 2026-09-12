import { AgentError } from "@tokenloom/schema";
import { TOOLS, toArgv } from "./tools";
import type { RunCli } from "./cli-port";

export * from "./tools";
export * from "./cli-port";
export * from "./node-cli-adapter";

export interface ToolResponse {
  content: { type: "text"; text: string }[];
  isError?: true;
}

/**
 * Successful commands pass stdout through, including results with warnings (docs/reference/spec.md section 4.9).
 * A failing Agent design-context command carries its structured error on stdout. Other failures preserve the
 * command diagnostic on stderr. Either way the response is an error.
 */
export function callTool(run: RunCli, name: string, args: Record<string, unknown>): ToolResponse {
  const mapped = toArgv(name, args);
  if ("error" in mapped) return { content: [{ type: "text", text: mapped.error }], isError: true };
  const res = run(mapped.argv);
  if (res.status !== 0) {
    let structuredAgentError = false;
    if (name === "design_context" && args.view === "agent") {
      try {
        structuredAgentError = AgentError.safeParse(JSON.parse(res.stdout)).success;
      } catch {
        structuredAgentError = false;
      }
    }
    const text = structuredAgentError ? res.stdout : res.stderr.trim() || `exit ${res.status}`;
    return { content: [{ type: "text", text }], isError: true };
  }
  return { content: [{ type: "text", text: res.stdout }] };
}

/** Keep the MCP SDK within the package allowed by docs/reference/verification.md. */
export async function serve(run: RunCli): Promise<void> {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server({ name: "tokenloom", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const res = callTool(run, request.params.name, request.params.arguments ?? {});
    // The SDK result union also includes task responses, so provide its indexed result shape.
    const out: { [key: string]: unknown } = { content: res.content };
    if (res.isError === true) out.isError = true;
    return out;
  });
  await server.connect(new StdioServerTransport());
}
