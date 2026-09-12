// SPEC 9.2 LLM adapter. Real model calls leave the process only from here, which is the boundary
// the network-confinement scan relies on.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { estimateTokens } from "@tokenloom/schema";
import { realRun } from "./child";
import type { ChildRun, LlmAdapter, LlmUsage } from "./model-port";

const EMPTY: LlmUsage = { inputTokens: 0, cacheCreation: 0, cacheRead: 0, outputTokens: 0, costUsd: null };
const DIAGNOSTIC_CHARS = 400;

/**
 * `claude -p --output-format json` reports its own refusals on stdout, so a failed call is
 * unreadable from stderr alone. Keeping the exit code and both stream ends is what lets a stop be
 * explained after the child is gone.
 */
function childDiagnostic(res: { code: number; stdout: string; stderr: string }): string {
  return [`exit ${String(res.code)}`, res.stdout.trim().slice(0, DIAGNOSTIC_CHARS),
    res.stderr.trim().slice(-DIAGNOSTIC_CHARS)].filter((part) => part !== "").join(" | ");
}
const RESTRICTED = "claude -p --output-format json --restricted --model <id>";

/** Fixed responses for `TOKENLOOM_LLM=fake`; tests, the verifier self-test, and --dry-run always use this path. */
export const fakeAdapter: LlmAdapter = {
  kind: "fake",
  async run(prompt, context) {
    const path = resolve(context.repoRoot, "packages/eval/samples/fake-responses", `${context.sampleName}.md`);
    if (!existsSync(path)) {
      return { ...EMPTY, text: "", model: "fake", ms: 0, invocation: "fake", error: `no fake response for ${context.sampleName}` };
    }
    const text = readFileSync(path, "utf8");
    return {
      ...EMPTY,
      text,
      model: "fake",
      ms: 0,
      invocation: "fake",
      inputTokens: estimateTokens(Buffer.byteLength(prompt, "utf8")),
      outputTokens: estimateTokens(Buffer.byteLength(text, "utf8")),
      costUsd: 0,
    };
  },
};

interface ClaudeJson {
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
      const args = ["-p", prompt, "--output-format", "json", "--restricted", "--model", context.model];
      const res = await run("claude", args, neutralCwd());
      const ms = Date.now() - started;
      if (res.code !== 0 || res.stdout.trim() === "") {
        return { ...EMPTY, text: "", model: context.model, ms, invocation: RESTRICTED, error: childDiagnostic(res) };
      }
      const parsed = JSON.parse(res.stdout) as ClaudeJson;
      const usage = parsed.usage ?? {};
      return {
        text: parsed.result ?? "",
        model: resolvedModel(parsed) ?? context.model,
        ms,
        invocation: RESTRICTED,
        inputTokens: usage.input_tokens ?? 0,
        cacheCreation: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        // Provider-calculated cost is authoritative for the cumulative budget (SPEC 9.6).
        costUsd: parsed.total_cost_usd ?? null,
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

/** Records the model ID reported by the response instead of an alias such as `--model opus`. */
function resolvedModel(parsed: ClaudeJson): string | undefined {
  const keys = Object.keys(parsed.modelUsage ?? {});
  return keys.length === 1 ? keys[0] : undefined;
}

export function selectAdapter(env: NodeJS.ProcessEnv = process.env): LlmAdapter {
  return env.TOKENLOOM_LLM === "fake" ? fakeAdapter : claudeAdapter;
}

export type { LlmAdapter, LlmResult, LlmUsage } from "./model-port";
