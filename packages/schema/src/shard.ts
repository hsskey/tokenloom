import { z } from "zod";
import { GateId, GateResult } from "./verify";

/** Output of `pnpm verify --gate host`: one result per host gate. */
export const HostGateResults = z.record(z.string(), GateResult);
export type HostGateResultsT = z.infer<typeof HostGateResults>;

/** One self-test sample's outcome inside a shard fragment; `id` is `<gate>/<sample>`. */
export const ShardSample = z.object({
  id: z.string(),
  asExpected: z.boolean(),
  detail: z.string(),
  reachable: z.array(GateId),
});
export type ShardSampleT = z.infer<typeof ShardSample>;

/**
 * Self-test result for one partition of the shard experiment. It covers only the samples its partition
 * selects, so it is never a VerifyReport and never stands for a complete verification.
 */
export const ShardFragment = z.object({
  kind: z.literal("shard-fragment"),
  shardIndex: z.number().int().nonnegative(),
  shardCount: z.number().int().positive(),
  sha: z.string().min(1),
  runId: z.string().min(1),
  runAttempt: z.string().min(1),
  baselinePass: z.boolean(),
  samples: z.array(ShardSample),
  /** Observational wall-clock splits of this shard's self-test. No check reads them. */
  timing: z.record(z.string(), z.number()),
});
export type ShardFragmentT = z.infer<typeof ShardFragment>;

export const ShardCheck = z.object({ name: z.string(), pass: z.boolean(), detail: z.string() });
export type ShardCheckT = z.infer<typeof ShardCheck>;

/**
 * Fail-closed merge of the host gates and every shard fragment. `authoritative` is always false:
 * only a complete `pnpm verify` run covers the whole contract.
 */
export const ShardAggregate = z.object({
  kind: z.literal("shard-aggregate"),
  authoritative: z.literal(false),
  green: z.boolean(),
  sha: z.string(),
  runId: z.string(),
  runAttempt: z.string(),
  shardCount: z.number().int().positive(),
  checks: z.array(ShardCheck),
});
export type ShardAggregateT = z.infer<typeof ShardAggregate>;
