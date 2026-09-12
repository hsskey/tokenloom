// Whole-task trajectory types. No I/O here: `ChildRun` stays the only child-process boundary.
import { stableStringify } from "@tokenloom/schema";
import type { ChildOutput, LlmResult } from "./model-port";
import { extractBlocks } from "./score";

/** Conditions a matrix may run: every view, tool name, and harness path is defined for exactly these. */
export type RunnableTrajectoryCondition = "cli-canonical" | "cli-agent" | "mcp-agent";
/** Record domain. `cli-agent-compact` is retained for archived records; it is not a runnable condition. */
export type TrajectoryCondition = RunnableTrajectoryCondition | "cli-agent-compact";
export type TrajectoryTask = "known-component" | "unknown-component" | "variant-only" | "recovery";
export interface TrajectoryToolCall { turn: number; tool: string; args: string[]; exitCode: number; bytes: number }
export interface TrajectoryRecovery { turn: number; code: string; resolved: boolean }
export interface TrajectoryTurn { index: number; prompt: string; result: LlmResult; toolCall: TrajectoryToolCall | null }
/** Generated output plus the locked inputs needed to recompute S1 and S2 without a new artifact store. */
export interface TrajectoryArtifact { output: string; sampleName: string; tokensCssSha256: string; referenceLockCommit: string }
/** Transport-agnostic tool call. Carrying stdin and complete stdout and stderr is the harness lane obligation. */
export interface ToolRequest { tool: string; args: string[]; stdin: string | null }
export interface ToolResponse { content: string; stderr: string; exitCode: number }
export interface ToolPort { readonly kind: "cli" | "mcp"; call(request: ToolRequest): Promise<ToolResponse> }

/** Pure turn composition: an implementation reads turns and returns text, and never runs a tool itself. */
export interface AgentSessionPort {
  readonly condition: RunnableTrajectoryCondition;
  /** Shared prompt inputs, including every view; its sha256 partitions revisions, not conditions. */
  readonly template: string;
  openingPrompt(task: TrajectoryTask): string;
  parseToolRequest(text: string): { tool: string; args: string[] } | null;
  followUpPrompt(turns: TrajectoryTurn[], toolOutput: string): string;
  isComplete(turns: TrajectoryTurn[]): boolean;
}

/** A `cmd: "trajectory"` JSONL row. Token fields sum the per-turn provider usage. */
export interface TrajectoryRun {
  cmd: "trajectory"; utcDate: string; task: TrajectoryTask; condition: TrajectoryCondition; repeat: number;
  adapter: "fake" | "claude"; model: string; invocation: string; success: boolean; turns: number; durationMs: number;
  inputTokens: number; cacheCreation: number; cacheRead: number; outputTokens: number; costUsd: number | null;
  s1: number | null; s2: number | null; artifact: TrajectoryArtifact | null; promptHash: string;
  toolCalls: TrajectoryToolCall[]; recovery: TrajectoryRecovery[]; incomparable?: boolean; error?: string;
}

/** `ChildRun` extended with stdin. MCP stdio needs JSON-RPC input; CLI conditions need full stderr. */
export type ChildRunWithStdin =
  (command: string, args: string[], cwd: string, stdin?: string) => Promise<ChildOutput>;

/** One trajectory task: the snapshot the harness queries and what the model is asked to build. */
export interface TrajectoryTaskSpec { task: TrajectoryTask; sampleName: string; snapshot: string; instruction: string }
/** Experiment input, so it lives in the matrix file like `packages/eval/prompts/css.md`, not in code. */
export interface TrajectoryPrompt { instructions: string; views: Record<RunnableTrajectoryCondition, string> }

/** The one line the model emits to request a query. The harness executes it; the model never does. */
export const TOOL_PREFIX = "TOOL ";
/** CLI conditions query the `context` command; the MCP condition queries the tool of the same contract. */
const TOOL_NAME: Record<RunnableTrajectoryCondition, string> = {
  "cli-canonical": "context", "cli-agent": "context", "mcp-agent": "design_context",
};

/**
 * Pure turn composition. The transcript lives in the returned prompts, so a follow-up prompt carries the
 * whole conversation and the provider bills it again; that repetition is the cost P8 measures.
 */
export function createSessionPort(
  condition: RunnableTrajectoryCondition, specs: TrajectoryTaskSpec[], prompt: TrajectoryPrompt,
): AgentSessionPort {
  const head = `${prompt.views[condition]}\n\n${prompt.instructions}`;
  return {
    condition,
    template: stableStringify({
      instructions: prompt.instructions,
      tasks: specs.map(({ task, instruction }) => ({ task, instruction })),
      views: prompt.views,
    }, 0),
    openingPrompt: (task) => `${head}\n\nTask: ${instructionOf(specs, task)}`,
    parseToolRequest: (text) => {
      const keyword = TOOL_PREFIX.trim();
      const line = text.split("\n").map((l) => l.trim())
        .filter((l) => l === keyword || l.startsWith(TOOL_PREFIX)).pop();
      if (line === undefined) return null;
      const args = line.slice(keyword.length).trim().split(/\s+/).filter((arg) => arg !== "");
      return { tool: TOOL_NAME[condition], args };
    },
    followUpPrompt: (turns, toolOutput) => {
      const last = turns[turns.length - 1];
      const before = last === undefined ? head : `${last.prompt}\n\n${last.result.text}`;
      return `${before}\n\n<tool-output>\n${toolOutput}\n</tool-output>\n\nContinue.`;
    },
    isComplete: (turns) => {
      const text = turns[turns.length - 1]?.result.text ?? "";
      const blocks = extractBlocks(text);
      return blocks.css !== null && blocks.html !== null && blocks.extra === 0
        && text.trim().replace(/```\s+```html/, "```\n```html") === `\`\`\`css\n${blocks.css}\`\`\`\n\`\`\`html\n${blocks.html}\`\`\``;
    },
  };
}

function instructionOf(specs: TrajectoryTaskSpec[], task: TrajectoryTask): string {
  const spec = specs.find((candidate) => candidate.task === task);
  if (spec === undefined) throw new Error(`trajectory: no task spec for ${task}`);
  return spec.instruction;
}
