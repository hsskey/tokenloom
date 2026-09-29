// Fail-closed merge of the shard experiment's host record and fragments into one non-authoritative record.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateIdT, HostGateResultsT, ShardAggregateT, ShardCheckT, ShardFragmentT } from "@tokenloom/schema";
import { HOST_GATES, HostGateResults, ShardFragment } from "@tokenloom/schema";
import { sampleReachableGates, selftestSamples } from "./gates/meta";
import { readRunProvenance, sampleId, type RunProvenance } from "./shard";
import type { VerifyContext } from "./verify-context";

/** Artifact layout shared with `.github/workflows/verify-shard.yml`. */
export const HOST_ARTIFACT = "verify-shard-host";
export const fragmentArtifact = (index: number, count: number): string => `verify-shard-${index}-of-${count}`;
export const RECORD_FILE = "record.json";

/** A downloaded record, or the reason it cannot be used. */
export type Slot<T> = { record: T } | { missing: string };

interface RecordSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };
}

export function readRecordSlot<T>(path: string, schema: RecordSchema<T>): Slot<T> {
  if (!existsSync(path)) return { missing: "absent" };
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return { missing: "empty" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { missing: `unparseable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { record: parsed.data };
  const issue = parsed.error.issues[0];
  return { missing: `invalid: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim() };
}

export function parseShardCount(raw: string | undefined): number {
  const count = Number(raw);
  if (raw === undefined || !Number.isInteger(count) || count < 1) {
    throw new Error(`--aggregate requires --shards <positive integer>, got ${String(raw)}`);
  }
  return count;
}

export interface AggregateInput {
  shardCount: number;
  provenance: RunProvenance;
  /** Sample ids and reachable gates derived from the source at the bound revision. */
  canonical: { ids: string[]; reachable: Record<string, GateIdT[]> };
  host: Slot<HostGateResultsT>;
  /** Indexed by shard; a hole is a fragment that was never downloaded. */
  fragments: Array<Slot<ShardFragmentT>>;
  /** GitHub `needs.<job>.result` for the producer jobs. */
  jobs: { host: string; shard: string };
}

export function collectAggregateInput(
  ctx: VerifyContext, dir: string, shardCount: number, env: NodeJS.ProcessEnv,
): AggregateInput {
  const samples = selftestSamples(ctx.root);
  return {
    shardCount,
    provenance: readRunProvenance(ctx, env),
    canonical: {
      ids: samples.map(sampleId),
      reachable: Object.fromEntries(samples.map((s) => [sampleId(s), sampleReachableGates(s, HOST_GATES).run])),
    },
    host: readRecordSlot(join(dir, HOST_ARTIFACT, RECORD_FILE), HostGateResults),
    fragments: Array.from({ length: shardCount }, (_, index) =>
      readRecordSlot(join(dir, fragmentArtifact(index, shardCount), RECORD_FILE), ShardFragment)),
    jobs: { host: env.TOKENLOOM_SHARD_HOST_RESULT ?? "", shard: env.TOKENLOOM_SHARD_FRAGMENTS_RESULT ?? "" },
  };
}

const checkOf = (name: string, problems: string[]): ShardCheckT =>
  ({ name, pass: problems.length === 0, detail: problems.length === 0 ? "ok" : problems.join("; ") });

function producerProblems(jobs: AggregateInput["jobs"]): string[] {
  return Object.entries(jobs)
    .filter(([, result]) => result !== "success")
    .map(([job, result]) => `${job} job concluded ${result === "" ? "absent" : result}`);
}

function presenceProblems(slots: Array<Slot<ShardFragmentT> | undefined>, shardCount: number): string[] {
  return slots.flatMap((slot, index) => {
    if (slot === undefined) return [`shard ${index}: absent`];
    if ("missing" in slot) return [`shard ${index}: ${slot.missing}`];
    const { shardIndex, shardCount: declared } = slot.record;
    const matchesSlot = shardIndex === index && declared === shardCount;
    return matchesSlot ? [] : [`shard ${index}: declares ${shardIndex}/${declared}`];
  });
}

const PROVENANCE_KEYS = ["sha", "runId", "runAttempt"] as const;

function provenanceProblems(fragments: ShardFragmentT[], provenance: RunProvenance): string[] {
  return fragments.flatMap((f) => PROVENANCE_KEYS
    .filter((key) => f[key] !== provenance[key])
    .map((key) => `shard ${f.shardIndex}: ${key} ${f[key]} differs from ${provenance[key]}`));
}

function baselineProblems(fragments: ShardFragmentT[]): string[] {
  return fragments.filter((f) => !f.baselinePass).map((f) => `shard ${f.shardIndex}: clean copy failed`);
}

/** The complete self-test fails without a sample for every host gate, so the union must cover them too. */
function unionProblems(fragments: ShardFragmentT[], canonicalIds: string[]): string[] {
  if (canonicalIds.length === 0) return ["no self-test samples at this revision"];
  const uncovered = HOST_GATES.filter((gate) => !canonicalIds.some((id) => id.startsWith(`${gate}/`)));
  const counts = new Map<string, number>();
  for (const id of fragments.flatMap((f) => f.samples.map((s) => s.id))) counts.set(id, (counts.get(id) ?? 0) + 1);
  const expected = new Set(canonicalIds);
  return [
    ...uncovered.map((gate) => `no self-test sample for ${gate}`),
    ...[...counts].filter(([, seen]) => seen > 1).map(([id]) => `duplicate ${id}`),
    ...canonicalIds.filter((id) => !counts.has(id)).map((id) => `missing ${id}`),
    ...[...counts.keys()].filter((id) => !expected.has(id)).map((id) => `unexpected ${id}`),
  ];
}

function verdictProblems(fragments: ShardFragmentT[]): string[] {
  return fragments.flatMap((f) => f.samples.filter((s) => !s.asExpected).map((s) => `${s.id}: ${s.detail}`));
}

/** Unknown ids are left to the union check so each defect is reported once. */
function reachabilityProblems(fragments: ShardFragmentT[], reachable: Record<string, GateIdT[]>): string[] {
  return fragments.flatMap((f) => f.samples.flatMap((s) => {
    const expected = reachable[s.id];
    if (expected === undefined || s.reachable.join(",") === expected.join(",")) return [];
    return [`${s.id}: ran ${s.reachable.join(",")} but the source reaches ${expected.join(",")}`];
  }));
}

function hostProblems(host: Slot<HostGateResultsT>): string[] {
  if ("missing" in host) return [`host record ${host.missing}`];
  return HOST_GATES.flatMap((gate) => {
    const result = host.record[gate];
    if (result === undefined) return [`${gate}: missing`];
    return result.pass === true ? [] : [`${gate}: ${String(result.reason ?? `pass ${String(result.pass)}`)}`];
  });
}

/** Green only when every check passes; any absent, malformed, mixed, or failing input turns it red. */
export function aggregateShards(input: AggregateInput): ShardAggregateT {
  const slots = Array.from({ length: input.shardCount }, (_, index) => input.fragments[index]);
  const fragments = slots.flatMap((slot) => (slot !== undefined && "record" in slot ? [slot.record] : []));
  const checks = [
    checkOf("producers", producerProblems(input.jobs)),
    checkOf("fragments", presenceProblems(slots, input.shardCount)),
    checkOf("provenance", provenanceProblems(fragments, input.provenance)),
    checkOf("baseline", baselineProblems(fragments)),
    checkOf("sample-union", unionProblems(fragments, input.canonical.ids)),
    checkOf("sample-verdicts", verdictProblems(fragments)),
    checkOf("reachability", reachabilityProblems(fragments, input.canonical.reachable)),
    checkOf("host-gates", hostProblems(input.host)),
  ];
  return {
    kind: "shard-aggregate",
    authoritative: false,
    green: checks.every((c) => c.pass),
    ...input.provenance,
    shardCount: input.shardCount,
    checks,
  };
}
