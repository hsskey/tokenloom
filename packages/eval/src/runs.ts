// SPEC 8 observation records. These JSONL rows are the report's sole data source.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stableStringify } from "@tokenloom/schema";
import { z } from "zod";
import { InputSource, InputVariant, NO_INPUT_VARIANT } from "./matrix";

export const EvaluationRun = z.object({
  cmd: z.literal("eval"),
  target: z.string(),
  /** UTC run date populated by the CLI for `--since` filtering and report headers. */
  utcDate: z.string(),
  sampleName: z.string(),
  inputVariant: z.union([InputVariant, z.literal(NO_INPUT_VARIANT)]),
  input: InputSource,
  repeat: z.number(),
  /** Separates fake data from real calls; reports aggregate only claude rows. */
  adapter: z.enum(["fake", "claude"]),
  model: z.string(),
  /** Adapter command shape; different invocations are not placed in the same table. */
  invocation: z.string(),
  promptHash: z.string(),
  bytesIn: z.number(),
  bytesOut: z.number(),
  ratio: z.number(),
  estTokens: z.number(),
  inputTokens: z.number(),
  cacheCreation: z.number(),
  cacheRead: z.number(),
  outputTokens: z.number(),
  costUsd: z.number().nullable(),
  ms: z.record(z.string(), z.number()),
  warnings: z.number(),
  skipped: z.string().optional(),
  error: z.string().optional(),
  s1: z.number().nullable().optional(),
  s2: z.number().nullable().optional(),
  s3: z.number().nullable().optional(),
  /** Rescored from a stored response and replaces the earlier row for the same combination (SPEC 9.6). */
  rescored: z.object({ at: z.string(), reason: z.string() }).optional(),
});
export type EvalRun = z.infer<typeof EvaluationRun>;

export function runsDir(repoRoot: string): string {
  return process.env.TOKENLOOM_RUNS_DIR ?? join(repoRoot, "runs");
}

export function appendRuns(repoRoot: string, utcDate: string, records: EvalRun[]): string {
  const dir = runsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${utcDate}.jsonl`);
  const stamped = records.map((r) => ({ ...r, utcDate }));
  appendFileSync(path, stamped.map((r) => stableStringify(r, 0)).join("\n") + "\n");
  return path;
}

/** All eval rows in `runs/*.jsonl`; reports and tests share this path. */
export function readRuns(repoRoot: string): EvalRun[] {
  return readRunsIn(runsDir(repoRoot));
}

/**
 * Committed run rows. `TOKENLOOM_RUNS_DIR` redirects writes only; reproducible estimates must use
 * repository rows rather than a machine-local temporary directory.
 */
export function readTrackedRuns(repoRoot: string): EvalRun[] {
  return readRunsIn(join(repoRoot, "runs"));
}

function readRunsIn(dir: string): EvalRun[] {
  if (!existsSync(dir)) return [];
  const out: EvalRun[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.cmd === "eval") out.push(decodeRun(record));
    }
  }
  return out;
}

/** Converts version-one run keys at the historical JSONL read boundary. */
function decodeRun(record: Record<string, unknown>): EvalRun {
  const sampleName = typeof record.sampleName === "string"
    ? record.sampleName
    : typeof record.fixture === "string" ? record.fixture : "";
  const inputVariant = typeof record.inputVariant === "string"
    ? record.inputVariant
    : typeof record.irLevel === "string" ? record.irLevel : "";
  const { fixture: _fixture, irLevel: _irLevel, ...canonical } = record;
  return EvaluationRun.parse({ ...canonical, sampleName, inputVariant });
}

export function repoRootFrom(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}
