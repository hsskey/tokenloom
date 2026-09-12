import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RunRecordT } from "@tokenloom/schema";
import { estimateTokens, stableStringify } from "@tokenloom/schema";

/** Read the clock only in the CLI; library packages remain deterministic. */
function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

export function repoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export interface RunInput {
  cmd: string;
  target: string;
  bytesIn: number;
  bytesOut: number;
  ms: Record<string, number>;
  warnings: number;
}

/** docs/reference/spec.md section 8: Append command records to runs/<utc-date>.jsonl, never stdout. */
export function appendRun(input: RunInput): void {
  const explicitDir = process.env.TOKENLOOM_RUNS_DIR;
  const root = repoRoot(resolve(process.cwd()));
  // The ledger belongs to a checkout. repoRoot falls back to the starting directory, so without
  // this check an out-of-repository run leaves a runs/ directory wherever the user happened to be.
  if (explicitDir === undefined && !existsSync(join(root, WORKSPACE_MARKER))) return;
  const record: RunRecordT = {
    ...input,
    ratio: input.bytesOut === 0 ? 0 : Number((input.bytesIn / input.bytesOut).toFixed(2)),
    estTokens: estimateTokens(input.bytesOut),
  };
  const dir = explicitDir ?? join(root, "runs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${utcDate()}.jsonl`), stableStringify(record, 0) + "\n");
}
