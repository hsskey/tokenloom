// Partial self-test runs for the non-authoritative shard experiment. The complete `pnpm verify` path never reads these.
import type { ShardFragmentT } from "@tokenloom/schema";
import { HOST_GATES } from "@tokenloom/schema";
import { runSampleCopies, sampleReachableGates, selftestSamples, selftestTiming, type Sample } from "./gates/meta";
import { git, type VerifyContext } from "./verify-context";

export interface ShardSelector {
  index: number;
  count: number;
}

export interface RunProvenance {
  sha: string;
  runId: string;
  runAttempt: string;
}

const SHARD_SELECTOR = /^(\d+)\/(\d+)$/;

/**
 * Parses `TOKENLOOM_SELFTEST_SHARD` as zero-based `<index>/<count>`. Unset or empty selects no shard and
 * keeps the complete sample set. Any other value throws, so a typo can never turn a shard job into a
 * silent complete run or an empty one.
 */
export function parseShardSelector(raw: string | undefined): ShardSelector | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const match = SHARD_SELECTOR.exec(raw.trim());
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  const inRange = match !== null && count >= 1 && index < count;
  if (!inRange) throw new Error(`invalid TOKENLOOM_SELFTEST_SHARD "${raw}": expected <index>/<count> with 0 <= index < count`);
  return { index, count };
}

/** A fragment describes exactly one shard, so producing one without a selector is an error. */
export function requireShardSelector(raw: string | undefined): ShardSelector {
  const selector = parseShardSelector(raw);
  if (selector === undefined) throw new Error("--shard-fragment requires TOKENLOOM_SELFTEST_SHARD=<index>/<count>");
  return selector;
}

/** Keeps the samples whose sorted position falls in this shard. Without a selector every sample stays. */
export function partitionByShard<T>(samples: T[], selector: ShardSelector | undefined): T[] {
  if (selector === undefined) return samples;
  return samples.filter((_, position) => position % selector.count === selector.index);
}

export const sampleId = (sample: Sample): string => `${sample.gate}/${sample.name}`;

/** Binds a record to the exact revision under test and to the workflow run attempt that produced it. */
export function readRunProvenance(ctx: VerifyContext, env: NodeJS.ProcessEnv): RunProvenance {
  const runId = env.GITHUB_RUN_ID ?? "";
  const runAttempt = env.GITHUB_RUN_ATTEMPT ?? "";
  if (runId === "" || runAttempt === "") throw new Error("shard records require GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT");
  const sha = git(ctx, ["rev-parse", "HEAD"]).trim();
  if (sha === "") throw new Error("shard records require a git revision; `git rev-parse HEAD` failed");
  return { sha, runId, runAttempt };
}

/**
 * Runs the clean baseline and this shard's samples through the same engine as the self-test gate, so each
 * sample keeps its reachable gates and expectation rule. A sample that never ran is not as expected.
 */
export async function produceShardFragment(
  ctx: VerifyContext, selector: ShardSelector, provenance: RunProvenance,
): Promise<ShardFragmentT> {
  const samples = partitionByShard(selftestSamples(ctx.root), selector);
  const run = await runSampleCopies(ctx, samples);
  const baselinePass = run.baselineFails.length === 0;
  const cases = new Map(run.cases.map((c) => [`${c.gate}/${c.sample}`, c]));
  return {
    kind: "shard-fragment",
    shardIndex: selector.index,
    shardCount: selector.count,
    ...provenance,
    baselinePass,
    samples: samples.map((sample) => {
      const verdict = cases.get(sampleId(sample));
      return {
        id: sampleId(sample),
        asExpected: verdict?.asExpected === true,
        detail: verdict?.detail ?? `not run: clean copy fails ${run.baselineFails.join(",")}`,
        reachable: sampleReachableGates(sample, HOST_GATES).run,
      };
    }),
    timing: selftestTiming(run.marks),
  };
}
