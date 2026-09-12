// MCP public schema size against its token budget, from the same measurement the MCP tests use.
// docs/reference/verification.md section 12.7 owns the threshold this record feeds.
import { estimateTokens } from "@tokenloom/schema";
import { TOOLS, schemaBytes } from "@tokenloom/mcp";
import type { BenchRecord } from "./util";

export function run(): BenchRecord {
  const bytes = schemaBytes();
  // estimateTokens derives tokens from bytes and is never reported as a provider token count.
  return { name: "mcp.schema", bytes, tokens: estimateTokens(bytes), tools: TOOLS.length };
}
