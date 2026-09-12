// Benchmark gate. bench measures; verify owns thresholds, verdicts, and synthetic input.
import { arch, cpus, platform } from "node:os";
import type { GateResultT } from "@tokenloom/schema";
import { fail, has, matchFiles, ok, read, sh, type VerifyContext } from "../verify-context";
import type { ProbeReading } from "../probe";

export interface BenchRecord {
  name: string;
  p50?: number;
  p99?: number;
  bytesP99?: number;
  ratioMedian?: number;
  scale10x?: number;
  heapMb?: number;
  heapMb1k?: number;
  heapSamples?: string;
  heapSamples1k?: string;
  ms?: number;
  contextBytes?: number;
  variants?: number;
  deltaBytes?: number;
  rootVariants?: number;
  warningBytes?: number;
  annotationBytes?: number;
  bytesReductionMedian?: number;
  bytesReductionMin?: number;
  expandedSamples?: number;
  minSample?: string;
  samples?: number;
  bytes?: number;
  tokens?: number;
  tools?: number;
  count?: number;
  returned?: number;
  /** A benchmark record field is a number or a string, so the producer records truncation as 1 or 0. */
  truncated?: number;
  componentSets?: number;
  fullBytes?: number;
  minVariant?: string;
}

export interface RealSample {
  name: string;
  contextBytes: number | null;
  variants: number | null;
  deltaBytes: number | null;
  rootVariants: number | null;
  warningBytes: number | null;
  annotationBytes: number | null;
}

/**
 * Moves `real.<directory>` records into verify.json realSamples. Captured-file designs sit outside the
 * threshold population, so this array never affects the verdict.
 */
export function realSamples(records: Map<string, BenchRecord>): RealSample[] {
  return [...records.entries()]
    .filter(([name]) => name.startsWith("real."))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, r]) => ({
      name: name.slice("real.".length),
      contextBytes: r.contextBytes ?? null,
      variants: r.variants ?? null,
      deltaBytes: r.deltaBytes ?? null,
      rootVariants: r.rootVariants ?? null,
      warningBytes: r.warningBytes ?? null,
      annotationBytes: r.annotationBytes ?? null,
    }));
}

/** Shape of a committed bench/results.jsonl row, including keys used before the design-context rename. */
interface LegacyBenchRecord extends Omit<BenchRecord, "name"> {
  name: string;
  irBytes?: number;
}

/**
 * Reads the latest row per record name from bench/results.jsonl. Rows committed before design context
 * was renamed are decoded here rather than rewritten: `ir.compact` and `irBytes` are the recorded
 * names in that history, and editing measured evidence to match current vocabulary would falsify it.
 */
export function latestRecords(text: string): Map<string, BenchRecord> {
  const out = new Map<string, BenchRecord>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const legacy = JSON.parse(line) as LegacyBenchRecord;
    const { irBytes, ...fields } = legacy;
    const record: BenchRecord = {
      ...fields,
      name: legacy.name === "ir.compact" ? "context.compact" : legacy.name,
      contextBytes: fields.contextBytes ?? irBytes,
    };
    out.set(record.name, record);
  }
  return out;
}


export interface HeapSummary {
  min: number | null;
  spread: number | null;
  note: string;
  samples: number[];
}

/** A heap sample set is unstable once its spread exceeds this fraction of the smallest reading. */
const UNSTABLE_RATIO = 0.5;
const UNSTABLE_NOTE = "unstable heap sample";

/**
 * Summarizes the heap-sample string; the verdict still uses the minimum. An unstable spread is only
 * recorded in the gate detail, because a noisy host is not evidence of a memory regression.
 */
export function summarizeHeap(text: string | undefined): HeapSummary {
  const samples = (text ?? "").split(" ").filter((s) => s !== "").map(Number);
  if (samples.length === 0 || samples.some((n) => Number.isNaN(n))) return { min: null, spread: null, note: "", samples: [] };
  const min = Math.min(...samples);
  const spread = Number((Math.max(...samples) - min).toFixed(1));
  return { min, spread, note: spread > UNSTABLE_RATIO * min ? UNSTABLE_NOTE : "", samples };
}

export interface EnvironmentVerdict {
  ok: boolean;
  ratio: ProbeReading;
  slower: (keyof ProbeReading)[];
}

/**
 * Flags only slower hosts (`measured / baseline > factor`). A faster host is not evidence of a noisy
 * runner, so the comparison is deliberately one-sided.
 */
export function judgeEnvironment(probe: ProbeReading, baseline: ProbeReading, factor: number): EnvironmentVerdict {
  const ratio = {
    allocMs: Number((probe.allocMs / baseline.allocMs).toFixed(3)),
    jsonParseMs: Number((probe.jsonParseMs / baseline.jsonParseMs).toFixed(3)),
  };
  const slower = (["jsonParseMs", "allocMs"] as const).filter((k) => ratio[k] > factor);
  return { ok: slower.length === 0, ratio, slower: [...slower] };
}

export const BASELINE = "packages/verify/baseline.json";

/** Recorded verdict scope; `partial_environment` means this host had no baseline and only host-independent items were judged. */
const MODES: Record<string, string> = { false: "full", true: "partial_environment" };

/** baseline.json host key derived from runtime facts without configuration or environment tuning. */
export function environmentKey(): string {
  const where = process.env.GITHUB_ACTIONS === "true" ? "gh" : "local";
  return `${where}-${platform()}-${arch()}-${cpus().length}`;
}

type Environments = Record<string, { probe?: Partial<ProbeReading> } | undefined>;

/**
 * Reads this host's baseline. Numeric values enable verdicts; null means the host is absent and skips
 * environment-sensitive items. A reason string describes missing repository data, not an invalid host.
 */
export function parseBaseline(text: string | null, key: string): ProbeReading | null | string {
  if (text === null) return `${BASELINE} is missing`;
  let environments: Environments | undefined;
  try {
    ({ environments } = JSON.parse(text) as { environments?: Environments });
  } catch (error) {
    return `${BASELINE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (environments === undefined || typeof environments !== "object") return `${BASELINE} has no environments map`;
  const entry = environments[key];
  if (entry === undefined) return null;
  const { allocMs, jsonParseMs } = entry.probe ?? {};
  const missing = typeof allocMs !== "number" || typeof jsonParseMs !== "number";
  if (missing) return `${BASELINE} has no numeric probe.allocMs / probe.jsonParseMs for ${key}`;
  return { allocMs, jsonParseMs };
}

/** Maps measured items to authoritative packages/verify/config.json threshold keys. */
export const THRESHOLD_OWNERS: Record<string, string> = {
  agent_bytes_reduction_pct: "bench.agentBytesReductionMedianMinPct",
  agent_expanded_samples: "bench.agentExpandedSamplesMax",
  agent_p99_ms: "bench.agentWarmP99Ms",
  cache_ms: "bench.cacheMs",
  heapMb: "bench.scaleHeapMb",
  context_p99_bytes: "bench.contextBytesP99",
  context_p99_ms: "bench.contextWarmP99Ms",
  discovery_bytes: "bench.discoveryBytesMax",
  discovery_returned: "bench.discoveryReturnedMax",
  mcp_schema_tokens: "bench.mcpSchemaTokensMax",
  mcp_tool_count: "bench.mcpToolCount",
  ratio_median: "bench.ratioMedianMin",
  scale10x: "bench.scale10xMax",
  tokens_p99_ms: "bench.tokensP99Ms",
  variant_bytes_reduction_pct: "bench.variantBytesReductionMedianMinPct",
};

/**
 * Host-independent size, ratio, and heap items remain judged without a baseline. Cache latency,
 * design-context p99, and token p99 depend on runner hardware.
 */
export const ENV_INDEPENDENT = [
  "heapMb", "context_p99_bytes", "ratio_median", "scale10x",
  "agent_bytes_reduction_pct", "agent_expanded_samples", "variant_bytes_reduction_pct",
  "discovery_bytes", "discovery_returned", "mcp_schema_tokens", "mcp_tool_count",
];

export function judgedItems(partial: boolean): string[] {
  const items = partial ? [...ENV_INDEPENDENT] : Object.keys(THRESHOLD_OWNERS).sort();
  return items.filter((item) => item in THRESHOLD_OWNERS);
}

export function agentTimingProblems(agent: BenchRecord | undefined, maximum: number): string[] {
  if (agent?.p99 === undefined) return ["agent projection p99 ms not measured"];
  return agent.p99 > maximum ? [`agent projection p99 ms ${agent.p99} > ${maximum}`] : [];
}

export function agentSizeProblems(
  agent: BenchRecord | undefined,
  referencePopulation: number,
  medianMinimum: number,
  expandedMaximum: number,
): string[] {
  const problems: string[] = [];
  if (agent?.bytesReductionMedian === undefined) problems.push("agent bytes reduction median not measured");
  else if (agent.bytesReductionMedian < medianMinimum) {
    problems.push(`agent bytes reduction median ${agent.bytesReductionMedian} < ${medianMinimum}`);
  }
  if (agent?.expandedSamples === undefined) problems.push("agent expanded samples not measured");
  else if (agent.expandedSamples > expandedMaximum) {
    problems.push(`agent expanded samples ${agent.expandedSamples} > ${expandedMaximum}`);
  }
  if (agent !== undefined && agent.samples !== referencePopulation) {
    problems.push(`agent samples ${String(agent.samples)} != ${referencePopulation} reference samples`);
  }
  return problems;
}

export function variantSizeProblems(
  variant: BenchRecord | undefined, expectedPopulation: number, medianMinimum: number,
): string[] {
  const problems: string[] = [];
  if (variant?.bytesReductionMedian === undefined) problems.push("Variant bytes reduction median not measured");
  else if (variant.bytesReductionMedian < medianMinimum) {
    problems.push(`Variant bytes reduction median ${variant.bytesReductionMedian} < ${medianMinimum}`);
  }
  if (variant?.bytesReductionMin === undefined) problems.push("Variant bytes reduction minimum not measured");
  if (variant?.variants !== expectedPopulation) {
    problems.push(`Variant samples ${String(variant?.variants)} != ${expectedPopulation}`);
  }
  if (variant?.fullBytes === undefined || variant.fullBytes <= 0) problems.push("Variant full context bytes not measured");
  return problems;
}

export function discoveryProblems(
  discovery: BenchRecord | undefined, maximumBytes: number, maximumReturned: number, minimumPopulation: number,
): string[] {
  const problems: string[] = [];
  if (discovery?.bytes === undefined) problems.push("discovery bytes not measured");
  else if (discovery.bytes > maximumBytes) problems.push(`discovery bytes ${discovery.bytes} > ${maximumBytes}`);
  if (discovery?.componentSets === undefined || discovery.componentSets < minimumPopulation) {
    problems.push(`discovery component sets ${String(discovery?.componentSets)} < ${minimumPopulation}`);
  }
  if (discovery?.count !== undefined && discovery.componentSets !== undefined
    && discovery.count !== discovery.componentSets) {
    problems.push(`discovery count ${discovery.count} != component sets ${discovery.componentSets}`);
  }
  if (discovery?.count === undefined || discovery.returned === undefined || discovery.truncated === undefined) {
    problems.push("discovery bounds not measured");
  } else {
    if (discovery.returned > maximumReturned) {
      problems.push(`discovery returned ${discovery.returned} > ${maximumReturned}`);
    }
    if (discovery.count < discovery.returned) {
      problems.push(`discovery count ${discovery.count} < returned ${discovery.returned}`);
    }
    // Strict equality against 1 and 0 rejects a boolean, a string and any other number without coercing it.
    if (discovery.truncated !== 0 && discovery.truncated !== 1) {
      problems.push(`discovery truncated ${JSON.stringify(discovery.truncated)} is neither 0 nor 1`);
    } else if (discovery.truncated !== (discovery.count > discovery.returned ? 1 : 0)) {
      problems.push("discovery truncated flag is incorrect");
    }
  }
  return problems;
}

export function mcpSchemaProblems(
  schema: BenchRecord | undefined, maximumTokens: number, expectedTools: number,
): string[] {
  const problems: string[] = [];
  if (schema?.tokens === undefined) problems.push("MCP schema tokens not measured");
  else if (schema.tokens > maximumTokens) problems.push(`MCP schema tokens ${schema.tokens} > ${maximumTokens}`);
  if (schema?.tools !== expectedTools) problems.push(`MCP tool count ${String(schema?.tools)} != ${expectedTools}`);
  if (schema?.bytes === undefined || schema.bytes <= 0) problems.push("MCP schema bytes not measured");
  return problems;
}

/** Records unjudged items beside their owning threshold keys; numbers remain in config.json. */
export function recordedItems(
  detail: Record<string, unknown>, judged: string[], owners: Record<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(owners)
    .filter(([item]) => !judged.includes(item))
    .map(([item, key]) => [item, { threshold: `config.json ${key}`, value: detail[item] ?? null }]));
}

export function environmentFailure(
  probe: ProbeReading, baseline: ProbeReading, verdict: EnvironmentVerdict, factor: number,
): GateResultT {
  const parse = `parse ${probe.jsonParseMs}ms / ${baseline.jsonParseMs}ms = ${verdict.ratio.jsonParseMs}x`;
  const alloc = `alloc ${probe.allocMs}ms / ${baseline.allocMs}ms = ${verdict.ratio.allocMs}x`;
  const over = `limit ${factor}x, exceeded: ${verdict.slower.join(", ")}`;
  const reason = `environment: probe is slower than baseline. ${parse}, ${alloc} (${over})`;
  return fail(reason, { invalid_environment: true, probe, baseline, ratio: verdict.ratio });
}

function runProbe(ctx: VerifyContext): ProbeReading | string {
  const run = sh(ctx, "node", ["--expose-gc", "node_modules/tsx/dist/cli.mjs", "packages/verify/src/probe.ts"]);
  try {
    return JSON.parse(run.stdout) as ProbeReading;
  } catch {
    return `probe did not report: ${run.stderr.slice(-300)}`;
  }
}

export async function benchmarks(ctx: VerifyContext): Promise<GateResultT> {
  const t = ctx.config.bench as Record<string, number>;
  const factor = t.probeDeviationMax as number;
  const key = environmentKey();
  const baseline = parseBaseline(has(ctx, BASELINE) ? read(ctx, BASELINE) : null, key);
  if (typeof baseline === "string") return fail(baseline);
  const probe = runProbe(ctx);
  if (typeof probe === "string") return fail(probe);
  // Skip benchmarks on a proven-slow host; an unlisted host has no baseline and skips sensitive verdicts.
  if (baseline !== null) {
    const verdict = judgeEnvironment(probe, baseline, factor);
    if (!verdict.ok) return environmentFailure(probe, baseline, verdict, factor);
  }
  const run = sh(ctx, "node", ["--expose-gc", "node_modules/tsx/dist/cli.mjs", "bench/run.ts", "--json"]);
  if (!has(ctx, "bench/results.jsonl")) {
    return fail("bench/results.jsonl is missing", { stderr: run.stderr.slice(-500) });
  }
  // A failed benchmark leaves prior result rows behind, so check status before judging stale values.
  if (run.status !== 0) {
    return fail(`bench run failed with status ${String(run.status)}`, { stderr: run.stderr.slice(-500) });
  }
  const records = latestRecords(read(ctx, "bench/results.jsonl"));
  const contextMetrics = records.get("context.compact");
  const tokens = records.get("tokens.build");
  const scale = records.get("scale");
  const cache = records.get("cache");
  const agent = records.get("context.agent");
  const variant = records.get("context.variant");
  const discovery = records.get("context.discovery");
  const mcpSchema = records.get("mcp.schema");
  // The population comes from tracked reference files, so a partial benchmark cannot pass by
  // measuring fewer samples than the repository actually locks.
  const referencePopulation = matchFiles(ctx, ["samples/*/reference/context.compact.json"]).length;

  const heap = summarizeHeap(scale?.heapSamples);
  const heap1k = summarizeHeap(scale?.heapSamples1k);
  const detail = {
    heapMb: heap.min,
    heapMb1k: heap1k.min,
    heap_note: heap.note,
    heap_samples: heap.samples,
    heap_samples_1k: heap1k.samples,
    heap_spread: heap.spread,
    heap_spread_1k: heap1k.spread,
    context_p99_ms: contextMetrics?.p99 ?? null,
    context_p50_ms: contextMetrics?.p50 ?? null,
    context_p99_bytes: contextMetrics?.bytesP99 ?? null,
    ratio_median: contextMetrics?.ratioMedian ?? null,
    tokens_p99_ms: tokens?.p99 ?? null,
    scale10x: scale?.scale10x ?? null,
    cache_ms: cache?.ms ?? null,
    agent_p99_ms: agent?.p99 ?? null,
    agent_p50_ms: agent?.p50 ?? null,
    agent_bytes_reduction_pct: agent?.bytesReductionMedian ?? null,
    agent_bytes_reduction_min_pct: agent?.bytesReductionMin ?? null,
    agent_expanded_samples: agent?.expandedSamples ?? null,
    agent_bytes_min_sample: agent?.minSample ?? null,
    agent_samples: agent?.samples ?? null,
    agent_reference_samples: referencePopulation,
    variant_bytes_reduction_pct: variant?.bytesReductionMedian ?? null,
    variant_bytes_reduction_min_pct: variant?.bytesReductionMin ?? null,
    variant_min_sample: variant?.minVariant ?? null,
    variant_samples: variant?.variants ?? null,
    variant_full_bytes: variant?.fullBytes ?? null,
    variant_p50_ms: variant?.p50 ?? null,
    variant_p99_ms: variant?.p99 ?? null,
    discovery_bytes: discovery?.bytes ?? null,
    discovery_count: discovery?.count ?? null,
    discovery_returned: discovery?.returned ?? null,
    discovery_truncated: discovery?.truncated ?? null,
    discovery_component_sets: discovery?.componentSets ?? null,
    discovery_p50_ms: discovery?.p50 ?? null,
    discovery_p99_ms: discovery?.p99 ?? null,
    mcp_schema_bytes: mcpSchema?.bytes ?? null,
    mcp_schema_tokens: mcpSchema?.tokens ?? null,
    mcp_tool_count: mcpSchema?.tools ?? null,
    probe,
    environment_key: key,
    ...(baseline === null ? { invalid_environment: true } : {}),
    realSamples: realSamples(records),
  };
  const judged = judgedItems(baseline === null);
  const problems: string[] = [];
  const over = (item: string, label: string, value: number | undefined, limit: number): void => {
    if (!judged.includes(item)) return;
    if (value === undefined) problems.push(`${label} not measured`);
    else if (value > limit) problems.push(`${label} ${value} > ${limit}`);
  };
  over("context_p99_ms", "design context p99 ms", contextMetrics?.p99, t.contextWarmP99Ms as number);
  over("context_p99_bytes", "design context p99 bytes", contextMetrics?.bytesP99, t.contextBytesP99 as number);
  over("tokens_p99_ms", "tokens p99 ms", tokens?.p99, t.tokensP99Ms as number);
  over("scale10x", "scale 10x", scale?.scale10x, t.scale10xMax as number);
  over("heapMb", "heap mb", heap.min ?? undefined, t.scaleHeapMb as number);
  over("cache_ms", "cache ms", cache?.ms, t.cacheMs as number);
  if (judged.includes("ratio_median")) {
    if (contextMetrics?.ratioMedian === undefined) problems.push("ratio median not measured");
    else if (contextMetrics.ratioMedian < (t.ratioMedianMin as number)) {
      problems.push(`ratio median ${contextMetrics.ratioMedian} < ${t.ratioMedianMin}`);
    }
  }
  if (judged.includes("agent_p99_ms")) {
    problems.push(...agentTimingProblems(agent, t.agentWarmP99Ms as number));
  }
  if (judged.includes("agent_bytes_reduction_pct")) {
    problems.push(...agentSizeProblems(
      agent,
      referencePopulation,
      t.agentBytesReductionMedianMinPct as number,
      t.agentExpandedSamplesMax as number,
    ));
  }
  if (judged.includes("variant_bytes_reduction_pct")) {
    problems.push(...variantSizeProblems(
      variant,
      t.variantSamples as number,
      t.variantBytesReductionMedianMinPct as number,
    ));
  }
  if (judged.includes("discovery_bytes")) {
    problems.push(...discoveryProblems(
      discovery,
      t.discoveryBytesMax as number,
      t.discoveryReturnedMax as number,
      t.discoveryPopulationMin as number,
    ));
  }
  if (judged.includes("mcp_schema_tokens")) {
    problems.push(...mcpSchemaProblems(mcpSchema, t.mcpSchemaTokensMax as number, t.mcpToolCount as number));
  }
  const scoped = {
    ...detail, judged, mode: MODES[String(baseline === null)] as string,
    recorded: recordedItems(detail, judged, THRESHOLD_OWNERS),
  };
  return problems.length === 0 ? ok(scoped) : fail(problems[0] as string, { ...scoped, problems });
}
