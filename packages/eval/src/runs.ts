// SPEC 8 observation records. These JSONL rows are the report's sole data source.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stableStringify } from "@tokenloom/schema";
import { z } from "zod";
import { Coverage, CoverageErrorCode } from "./coverage";
import { InputSource, InputVariant, NO_INPUT_VARIANT } from "./matrix";
import type { ChildRun, HarnessCommit } from "./model-port";

const ProviderCallEvidenceRow = z.object({
  format: z.enum(["json", "stream-json"]),
  initModel: z.string().nullable(),
  assistantModels: z.array(z.string()),
  modelUsage: z.record(z.string(), z.unknown()),
});

const ArtifactRow = z.object({
  output: z.string(), sampleName: z.string(), tokensCssSha256: z.string(), referenceLockCommit: z.string(),
});

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
  /** Variant coverage (SPEC 9.5, J1). Absent on rows recorded before the metric existed. */
  coverageStatus: z.enum(["measured", "error"]).optional(),
  coverage: Coverage.nullable().optional(),
  coverageError: CoverageErrorCode.optional(),
  /** Rescored from a stored response and replaces the earlier row for the same combination (SPEC 9.6). */
  rescored: z.object({ at: z.string(), reason: z.string() }).optional(),
  requestedModel: z.string().optional(),
  resolvedModel: z.string().nullable().optional(),
  modelResolution: z.enum(["producing-message", "sole-model-usage-key"]).nullable().optional(),
  providerEvidence: z.array(ProviderCallEvidenceRow).optional(),
  harnessCommit: z.object({ sha: z.string(), dirty: z.boolean() }).optional(),
  artifact: ArtifactRow.optional(),
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

const MANIFEST_PATH = "samples/manifest.json";
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export async function readHarnessCommit(child: ChildRun, repoRoot: string): Promise<HarnessCommit> {
  const head = await child("git", ["rev-parse", "HEAD"], repoRoot);
  const sha = head.stdout.trim();
  if (head.code !== 0 || !COMMIT_SHA.test(sha)) throw new Error("harnessCommit: HEAD lookup failed");
  const status = await child("git", ["status", "--porcelain", "--", ".", ":(exclude)runs/"], repoRoot);
  if (status.code !== 0) throw new Error("harnessCommit: status lookup failed");
  return { sha, dirty: status.stdout.trim() !== "" };
}

export async function readReferenceLockCommit(child: ChildRun, repoRoot: string): Promise<string> {
  const log = await child("git", ["log", "-1", "--format=%H", "--", MANIFEST_PATH], repoRoot);
  const lock = log.stdout.trim();
  if (log.code !== 0 || !COMMIT_SHA.test(lock)) throw new Error("referenceLock: lookup failed");
  return lock;
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
