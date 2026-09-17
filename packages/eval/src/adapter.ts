// SPEC 9.2 LLM adapter. Real model calls leave the process only from here, which is the boundary
// the network-confinement scan relies on.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { estimateTokens } from "@tokenloom/schema";
import { realRun } from "./child";
import type {
  ChildRun, LlmAdapter, LlmUsage, ModelResolution, ProviderCallEvidence,
} from "./model-port";

const EMPTY: LlmUsage = { inputTokens: 0, cacheCreation: 0, cacheRead: 0, outputTokens: 0, costUsd: null };
const DIAGNOSTIC_CHARS = 400;
const UNRESOLVED = { resolvedModel: null, modelResolution: null } as const;

/**
 * `claude -p --output-format json` reports its own refusals on stdout, so a failed call is
 * unreadable from stderr alone. Keeping the exit code and both stream ends is what lets a stop be
 * explained after the child is gone.
 */
function childDiagnostic(res: { code: number; stdout: string; stderr: string }): string {
  return [`exit ${String(res.code)}`, res.stdout.trim().slice(0, DIAGNOSTIC_CHARS),
    res.stderr.trim().slice(-DIAGNOSTIC_CHARS)].filter((part) => part !== "").join(" | ");
}
const RESTRICTED = "claude -p --output-format stream-json --verbose --restricted --model <id>";

/** Fixed responses for `TOKENLOOM_LLM=fake`; tests, the verifier self-test, and --dry-run always use this path. */
export const fakeAdapter: LlmAdapter = {
  kind: "fake",
  async run(prompt, context) {
    const provenance = { requestedModel: context.model, ...UNRESOLVED, providerEvidence: null };
    const path = resolve(context.repoRoot, "packages/eval/samples/fake-responses", `${context.sampleName}.md`);
    if (!existsSync(path)) {
      return { ...EMPTY, text: "", model: "fake", ...provenance, ms: 0, invocation: "fake",
        error: `no fake response for ${context.sampleName}` };
    }
    const text = readFileSync(path, "utf8");
    return {
      ...EMPTY,
      text,
      model: "fake",
      ...provenance,
      ms: 0,
      invocation: "fake",
      inputTokens: estimateTokens(Buffer.byteLength(prompt, "utf8")),
      outputTokens: estimateTokens(Buffer.byteLength(text, "utf8")),
      costUsd: 0,
    };
  },
};

interface ClaudeResult {
  type?: string;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  message?: { model?: string };
}

interface ModelStream {
  parsedAny: boolean;
  result: ClaudeResult | null;
  initModel: string | null;
  mainLoopModels: (string | undefined)[];
}

// A malformed line is skipped rather than thrown, so one bad line does not discard a paid call.
function parseModelStream(stream: string): ModelStream {
  const out: ModelStream = { parsedAny: false, result: null, initModel: null, mainLoopModels: [] };
  for (const line of stream.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;
    let event: StreamEvent;
    try { event = JSON.parse(trimmed) as StreamEvent; } catch { continue; }
    out.parsedAny = true;
    if (event.type === "system" && event.subtype === "init") out.initModel = event.model ?? null;
    // A main-loop assistant message has no parent tool use; a subagent's is not a producing message.
    if (event.type === "assistant" && (event.parent_tool_use_id ?? null) === null) {
      out.mainLoopModels.push(event.message?.model);
    }
    if (event.type === "result") out.result = event as ClaudeResult;
  }
  return out;
}

function distinctAssistantModels(mainLoopModels: (string | undefined)[]): string[] {
  return [...new Set(mainLoopModels.filter((m): m is string => typeof m === "string" && m.length > 0))];
}

/**
 * SPEC 9.1 J3 resolution. Contradictory producing evidence (disagreeing or omitted models, or a
 * rule 1/2 conflict) resolves to `null` rather than a usage key, so a known contradiction is never hidden.
 */
function resolveModel(
  mainLoopModels: (string | undefined)[], modelUsage: Record<string, unknown>,
): { resolvedModel: string | null; modelResolution: ModelResolution | null } {
  const usageKeys = Object.keys(modelUsage);
  const soleKey = usageKeys.length === 1 ? usageKeys[0] ?? null : null;
  if (mainLoopModels.length > 0) {
    const named = distinctAssistantModels(mainLoopModels);
    const everyMessageNamed = mainLoopModels.every((m) => typeof m === "string" && m.length > 0);
    if (everyMessageNamed && named.length === 1) {
      const value = named[0] as string;
      if (soleKey !== null && soleKey !== value) return UNRESOLVED;
      return { resolvedModel: value, modelResolution: "producing-message" };
    }
    return UNRESOLVED;
  }
  if (soleKey !== null) return { resolvedModel: soleKey, modelResolution: "sole-model-usage-key" };
  return UNRESOLVED;
}

/**
 * `--restricted` plus a neutral working directory keep local tools, MCP servers, settings, and
 * repository instructions out of the model input. Without them the same prompt would carry
 * different inputs on every machine, and SPEC 9.6 only compares rows sharing a model and prompt
 * hash. It also cuts the billed input substantially; `runs/*.jsonl` holds the measured figures.
 * Tests inject the child boundary through `run`; the default is the guarded real implementation.
 */
export function createClaudeAdapter(run: ChildRun = realRun): LlmAdapter {
  return {
    kind: "claude",
    async run(prompt, context) {
      const started = Date.now();
      const requestedModel = context.model;
      const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--restricted", "--model", requestedModel];
      const res = await run("claude", args, neutralCwd());
      const ms = Date.now() - started;
      const failed = (evidence: ProviderCallEvidence | null) =>
        ({ ...EMPTY, text: "", model: requestedModel, requestedModel, ...UNRESOLVED, providerEvidence: evidence,
          ms, invocation: RESTRICTED, error: childDiagnostic(res) });
      if (res.code !== 0 || res.stdout.trim() === "") return failed(null);
      const stream = parseModelStream(res.stdout);
      const modelUsage = stream.result?.modelUsage ?? {};
      const evidence: ProviderCallEvidence | null = stream.parsedAny
        ? { format: "stream-json", initModel: stream.initModel,
            assistantModels: distinctAssistantModels(stream.mainLoopModels), modelUsage }
        : null;
      if (stream.result === null) return failed(evidence);
      const usage = stream.result.usage ?? {};
      const { resolvedModel, modelResolution } = resolveModel(stream.mainLoopModels, modelUsage);
      return {
        text: stream.result.result ?? "",
        model: resolvedModel ?? requestedModel,
        requestedModel,
        resolvedModel,
        modelResolution,
        providerEvidence: evidence,
        ms,
        invocation: RESTRICTED,
        inputTokens: usage.input_tokens ?? 0,
        cacheCreation: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        // Provider-calculated cost is authoritative for the cumulative budget (SPEC 9.6).
        costUsd: stream.result.total_cost_usd ?? null,
      };
    },
  };
}

/** Default adapter used by `selectAdapter` and the CLI. */
export const claudeAdapter: LlmAdapter = createClaudeAdapter();

let cachedCwd: string | undefined;
function neutralCwd(): string {
  cachedCwd ??= mkdtempSync(join(tmpdir(), "tl-llm-"));
  return cachedCwd;
}

export function selectAdapter(env: NodeJS.ProcessEnv = process.env): LlmAdapter {
  return env.TOKENLOOM_LLM === "fake" ? fakeAdapter : claudeAdapter;
}

export type { LlmAdapter, LlmResult, LlmUsage } from "./model-port";
