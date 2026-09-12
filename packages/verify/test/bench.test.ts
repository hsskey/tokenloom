import { readFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { discoveryRecord, discoverySnapshot } from "../../../bench/discovery.bench";
import { rawPercentile } from "../../../bench/util";
// The workspace does not link parser into verify, so the producer path is used, as the bench modules do.
import { discoverComponentSets } from "../../parser/src/index";
import {
  ENV_INDEPENDENT, THRESHOLD_OWNERS, agentSizeProblems, agentTimingProblems,
  discoveryProblems, environmentFailure, environmentKey, judgeEnvironment, judgedItems,
  latestRecords, mcpSchemaProblems, parseBaseline, recordedItems, summarizeHeap,
  variantSizeProblems,
} from "../src/gates/bench";
import type { ProbeReading } from "../src/probe";

/** Fixed values in the normal post-reboot range; tests perform no timing. */
const BASE: ProbeReading = { allocMs: 30, jsonParseMs: 42 };

describe("benchmark record decoding", () => {
  it("normalizes historical context metric names at the JSONL boundary", () => {
    const records = latestRecords('{"name":"ir.compact","irBytes":6120,"p50":8}\n');
    expect(records.get("context.compact")).toEqual({ name: "context.compact", contextBytes: 6120, p50: 8 });
  });

  it.each([
    { median: 3.999, problems: ["agent bytes reduction median 3.999 < 4"] },
    { median: 4, problems: [] },
    { median: 4.001, problems: [] },
  ])("judges serialized Agent evidence at the exact four-percent boundary: $median", ({ median, problems }) => {
    const records = latestRecords(`${JSON.stringify({
      name: "context.agent", bytesReductionMedian: median, expandedSamples: 0, samples: 9,
    })}\n`);

    expect(agentSizeProblems(records.get("context.agent"), 9, 4, 0)).toEqual(problems);
  });

  it("rejects a serialized sample expansion independently of its reduction display", () => {
    const records = latestRecords('{"name":"context.agent","bytesReductionMedian":4,"expandedSamples":1,"samples":9}\n');

    expect(agentSizeProblems(records.get("context.agent"), 9, 4, 0))
      .toEqual(["agent expanded samples 1 > 0"]);
  });

  it.each([
    { measured: 4.9999, problems: [] },
    { measured: 5, problems: [] },
    { measured: 5.0004, problems: ["agent projection p99 ms 5.0004 > 5"] },
  ])("preserves and judges raw Agent p99 evidence at $measured ms", ({ measured, problems }) => {
    const record = { name: "context.agent", p50: rawPercentile([measured], 50), p99: rawPercentile([measured], 99) };
    const records = latestRecords(`${JSON.stringify(record)}\n`);

    expect(agentTimingProblems(records.get("context.agent"), 5)).toEqual(problems);
  });
});

describe("P7 selective-disclosure benchmark evidence", () => {
  it.each([
    { median: 44.999, problems: ["Variant bytes reduction median 44.999 < 45"] },
    { median: 45, problems: [] },
    { median: 45.001, problems: [] },
  ])("judges raw Variant reduction at the configured boundary: $median", ({ median, problems }) => {
    const record = {
      name: "context.variant", bytesReductionMedian: median, bytesReductionMin: 40, variants: 19, fullBytes: 7602,
    };
    expect(variantSizeProblems(record, 19, 45)).toEqual(problems);
  });

  it("rejects missing Variant evidence and an empty or partial population", () => {
    expect(variantSizeProblems(undefined, 19, 45)).toEqual([
      "Variant bytes reduction median not measured",
      "Variant bytes reduction minimum not measured",
      "Variant samples undefined != 19",
      "Variant full context bytes not measured",
    ]);
    expect(variantSizeProblems({
      name: "context.variant", bytesReductionMedian: 60, bytesReductionMin: 55, variants: 0, fullBytes: 0,
    }, 19, 45)).toEqual(["Variant samples 0 != 19", "Variant full context bytes not measured"]);
  });

  it.each([
    { bytes: 4096, returned: 20, problems: [] },
    { bytes: 4097, returned: 20, problems: ["discovery bytes 4097 > 4096"] },
    { bytes: 4096, returned: 21, problems: ["discovery returned 21 > 20"] },
  ])("judges discovery envelope bytes and returned count: $bytes/$returned", ({ bytes, returned, problems }) => {
    const record = { name: "context.discovery", bytes, componentSets: 24, count: 24, returned, truncated: 1 };
    expect(discoveryProblems(record, 4096, 20, 20)).toEqual(problems);
  });

  it("rejects a small discovery population and a false truncation claim", () => {
    const record = { name: "context.discovery", bytes: 1000, componentSets: 19, count: 19, returned: 19, truncated: 1 };
    expect(discoveryProblems(record, 4096, 20, 20)).toEqual([
      "discovery component sets 19 < 20",
      "discovery truncated flag is incorrect",
    ]);
  });

  it.each([
    {
      label: "empty discovery for a nonempty input",
      record: { name: "context.discovery", bytes: 1000, componentSets: 24, count: 0, returned: 0, truncated: 0 },
      problem: "discovery count 0 != component sets 24",
    },
    {
      label: "nonempty partial discovery count",
      record: { name: "context.discovery", bytes: 1000, componentSets: 24, count: 23, returned: 20, truncated: 1 },
      problem: "discovery count 23 != component sets 24",
    },
  ])("rejects $label", ({ record, problem }) => {
    expect(discoveryProblems(record, 4096, 20, 20)).toEqual([problem]);
  });

  it("catches removal of the unfiltered discovery population check", () => {
    const records = [
      { name: "context.discovery", bytes: 1000, componentSets: 24, count: 0, returned: 0, truncated: 0 },
      { name: "context.discovery", bytes: 1000, componentSets: 24, count: 23, returned: 20, truncated: 1 },
    ];
    const acceptedWithoutEquality = records.filter((record) =>
      record.bytes <= 4096
      && record.componentSets >= 20
      && record.returned <= 20
      && record.count >= record.returned
      && record.truncated === (record.count > record.returned ? 1 : 0));
    const caught = records.filter((record) => discoveryProblems(record, 4096, 20, 20).length > 0).length;

    expect({ attempted: records.length, caught, survived: records.length - caught, acceptedWithoutEquality: acceptedWithoutEquality.length })
      .toEqual({ attempted: 2, caught: 2, survived: 0, acceptedWithoutEquality: 2 });
  });

  // D020 fixed the transport at numeric 0 or 1. Anything else is rejected rather than coerced.
  it.each([
    { truncated: 1, problems: [] },
    { truncated: 0, problems: ["discovery truncated flag is incorrect"] },
    { truncated: 2, problems: ['discovery truncated 2 is neither 0 nor 1'] },
    { truncated: -1, problems: ['discovery truncated -1 is neither 0 nor 1'] },
    { truncated: "1", problems: ['discovery truncated "1" is neither 0 nor 1'] },
    { truncated: true, problems: ["discovery truncated true is neither 0 nor 1"] },
    { truncated: false, problems: ["discovery truncated false is neither 0 nor 1"] },
    { truncated: undefined, problems: ["discovery bounds not measured"] },
  ])("accepts only 0 or 1 as the truncation transport: $truncated", ({ truncated, problems }) => {
    const record = { name: "context.discovery", bytes: 1345, componentSets: 24, count: 24, returned: 20, truncated };

    expect(discoveryProblems(record as never, 4096, 20, 20)).toEqual(problems);
  });

  it("accepts 0 from an untruncated population", () => {
    const record = { name: "context.discovery", bytes: 1000, componentSets: 20, count: 20, returned: 20, truncated: 0 };

    expect(discoveryProblems(record, 4096, 20, 20)).toEqual([]);
  });

  /**
   * The first full P7 attempt failed here: the producer records 1 and the gate compared it to `true`.
   * This case consumes the real producer, so the two contracts cannot drift apart again. No timing loop runs.
   */
  it("accepts the record built by the real discovery benchmark producer", () => {
    const snapshot = discoverySnapshot(Array.from({ length: 24 }, (_, i) => `Comp${String(i).padStart(2, "0")}`));
    const record = discoveryRecord(discoverComponentSets(snapshot), snapshot.componentSets.length, [1, 2]);

    expect([record.truncated, record.count, record.returned]).toEqual([1, 24, 20]);
    expect(discoveryProblems(record, 4096, 20, 20)).toEqual([]);
  });

  it.each([
    { tokens: 800, tools: 2, problems: [] },
    { tokens: 801, tools: 2, problems: ["MCP schema tokens 801 > 800"] },
    { tokens: 800, tools: 3, problems: ["MCP tool count 3 != 2"] },
  ])("judges MCP schema tokens and exact tool count: $tokens/$tools", ({ tokens, tools, problems }) => {
    expect(mcpSchemaProblems({ name: "mcp.schema", bytes: 1314, tokens, tools }, 800, 2)).toEqual(problems);
  });

  it("maps camelCase records to their snake_case evidence owners", () => {
    const records = latestRecords([
      '{"name":"context.variant","bytesReductionMedian":56.525,"bytesReductionMin":55.275,"variants":19,"fullBytes":7602}',
      '{"name":"context.discovery","bytes":1345,"componentSets":24,"count":24,"returned":20,"truncated":1}',
      '{"name":"mcp.schema","bytes":1314,"tokens":469,"tools":2}',
    ].join("\n"));
    expect(records.get("context.variant")?.bytesReductionMedian).toBe(56.525);
    expect(records.get("context.discovery")?.returned).toBe(20);
    expect(records.get("mcp.schema")?.tokens).toBe(469);
  });
});

describe("environment-calibration verdict", () => {
  it("passes when both probes stay within 1.5x of baseline", () => {
    expect(judgeEnvironment({ allocMs: 44, jsonParseMs: 62 }, BASE, 1.5)).toEqual({
      ok: true, ratio: { allocMs: 1.467, jsonParseMs: 1.476 }, slower: [],
    });
  });

  it("reports only the parse probe when it alone exceeds 1.5x", () => {
    expect(judgeEnvironment({ allocMs: 30, jsonParseMs: 64 }, BASE, 1.5)).toEqual({
      ok: false, ratio: { allocMs: 1, jsonParseMs: 1.524 }, slower: ["jsonParseMs"],
    });
  });

  it("fails the environment when only the allocation probe exceeds 1.5x", () => {
    expect(judgeEnvironment({ allocMs: 46, jsonParseMs: 42 }, BASE, 1.5)).toEqual({
      ok: false, ratio: { allocMs: 1.533, jsonParseMs: 1 }, slower: ["allocMs"],
    });
  });

  it("passes at exactly 1.5x because the boundary is not exceeded", () => {
    expect(judgeEnvironment({ allocMs: 45, jsonParseMs: 63 }, BASE, 1.5)).toEqual({
      ok: true, ratio: { allocMs: 1.5, jsonParseMs: 1.5 }, slower: [],
    });
  });

  it("passes a host faster than baseline because it is not a noisy slow runner", () => {
    expect(judgeEnvironment({ allocMs: 3, jsonParseMs: 4 }, BASE, 1.5)).toEqual({
      ok: true, ratio: { allocMs: 0.1, jsonParseMs: 0.095 }, slower: [],
    });
  });

  it("reports both probes for the 2.5x band observed in the 2026-09-03 failure", () => {
    expect(judgeEnvironment({ allocMs: 75, jsonParseMs: 105 }, BASE, 1.5).slower).toEqual(["jsonParseMs", "allocMs"]);
  });
});

describe("environment-failure shape", () => {
  const probe: ProbeReading = { allocMs: 46, jsonParseMs: 105 };
  const verdict = judgeEnvironment(probe, BASE, 1.5);

  it("includes the environment label, both probe values, baselines, and ratios in the reason", () => {
    expect(environmentFailure(probe, BASE, verdict, 1.5).reason).toBe(
      "environment: probe is slower than baseline. parse 105ms / 42ms = 2.5x, alloc 46ms / 30ms = 1.533x"
        + " (limit 1.5x, exceeded: jsonParseMs, allocMs)",
    );
  });

  it("returns invalid_environment with probes, baselines, and ratios", () => {
    expect(environmentFailure(probe, BASE, verdict, 1.5)).toMatchObject({
      pass: false,
      invalid_environment: true,
      probe: { allocMs: 46, jsonParseMs: 105 },
      baseline: { allocMs: 30, jsonParseMs: 42 },
      ratio: { allocMs: 1.533, jsonParseMs: 2.5 },
    });
  });
});

describe("baseline.json environment key", () => {
  const saved = process.env.GITHUB_ACTIONS;
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = saved;
  });

  it("joins CI mode, platform, architecture, and core count in that order", () => {
    delete process.env.GITHUB_ACTIONS;
    expect(environmentKey().split("-")).toEqual(["local", platform(), arch(), String(cpus().length)]);
  });

  it("changes only the prefix to gh when GITHUB_ACTIONS is true", () => {
    process.env.GITHUB_ACTIONS = "true";
    expect(environmentKey().split("-")).toEqual(["gh", platform(), arch(), String(cpus().length)]);
  });

  it("does not classify other GITHUB_ACTIONS values as a CI runner", () => {
    process.env.GITHUB_ACTIONS = "false";
    expect(environmentKey().startsWith("local-")).toBe(true);
  });

  it("uses different keys for hosts with different core counts", () => {
    delete process.env.GITHUB_ACTIONS;
    const local = environmentKey();
    process.env.GITHUB_ACTIONS = "true";
    expect(environmentKey()).not.toBe(local);
  });
});

describe("baseline.json reading", () => {
  const KEY = "gh-linux-x64-4";
  const file = (probe: string): string => `{"note":"x","environments":{"${KEY}":{"probe":${probe}}}}`;

  it("returns an ordinary gate-failure reason rather than an environment failure when absent", () => {
    expect(parseBaseline(null, KEY)).toBe("packages/verify/baseline.json is missing");
  });

  it("includes the file name and parse error when JSON is malformed", () => {
    expect(parseBaseline("{oops", KEY)).toMatch(/^packages\/verify\/baseline\.json is not valid JSON: /);
  });

  it("treats a legacy flat file as a repository problem rather than a host failure", () => {
    expect(parseBaseline('{"probe":{"allocMs":30,"jsonParseMs":42}}', KEY)).toBe(
      "packages/verify/baseline.json has no environments map",
    );
  });

  it("returns null when the host is absent so environment-sensitive items are not judged", () => {
    expect(parseBaseline(file('{"allocMs":30,"jsonParseMs":42}'), "gh-linux-x64-2")).toBeNull();
  });

  it("includes the key when a listed host has a nonnumeric probe value", () => {
    expect(parseBaseline(file('{"allocMs":30,"jsonParseMs":"42"}'), KEY)).toBe(
      "packages/verify/baseline.json has no numeric probe.allocMs / probe.jsonParseMs for gh-linux-x64-4",
    );
  });

  it("returns only the two numeric probe values for a listed host", () => {
    expect(parseBaseline(file('{"allocMs":30.1,"jsonParseMs":42.2}'), KEY)).toEqual({
      allocMs: 30.1, jsonParseMs: 42.2,
    });
  });

  it("returns values for another requested key in the same file", () => {
    const two = '{"environments":{"a":{"probe":{"allocMs":1,"jsonParseMs":2}},'
      + '"b":{"probe":{"allocMs":3,"jsonParseMs":4}}}}';
    expect([parseBaseline(two, "a"), parseBaseline(two, "b")]).toEqual([
      { allocMs: 1, jsonParseMs: 2 }, { allocMs: 3, jsonParseMs: 4 },
    ]);
  });

  it("returns null for a runner key absent from the shipped local-only baseline", () => {
    const text = readFileSync(new URL("../baseline.json", import.meta.url), "utf8");
    const keys = Object.keys((JSON.parse(text) as { environments: Record<string, unknown> }).environments);
    expect(keys).toEqual(["local-darwin-arm64-12"]);
    expect(parseBaseline(text, "local-darwin-arm64-12")).toEqual({ allocMs: 29.229, jsonParseMs: 42.137 });
    expect(parseBaseline(text, "gh-linux-x64-2")).toBeNull();
  });
});

describe("heap-sample summary", () => {
  it("returns the minimum and spread with no warning for stable samples", () => {
    expect(summarizeHeap("18.7 18.6 18.6 18.6 18.6")).toEqual({
      min: 18.6, spread: 0.1, note: "", samples: [18.7, 18.6, 18.6, 18.6, 18.6],
    });
  });

  it("records unstable heap sample when spread exceeds 50% of the minimum", () => {
    expect(summarizeHeap("100 100 100 100 151")).toEqual({
      min: 100, spread: 51, note: "unstable heap sample", samples: [100, 100, 100, 100, 151],
    });
  });

  it("does not mark a spread at exactly 50% of the minimum as unstable", () => {
    expect(summarizeHeap("100 150")).toEqual({ min: 100, spread: 50, note: "", samples: [100, 150] });
  });

  it("returns zero spread for a single sample such as the 2026-09-04 failure value", () => {
    expect(summarizeHeap("214.5")).toEqual({ min: 214.5, spread: 0, note: "", samples: [214.5] });
  });

  it("uses the minimum for a large outlier and records an unstable-sample warning", () => {
    expect(summarizeHeap("18.6 30.0 18.7 18.6 18.6")).toEqual({
      min: 18.6, spread: 11.4, note: "unstable heap sample", samples: [18.6, 30, 18.7, 18.6, 18.6],
    });
  });

  it.each([["samples are absent", undefined], ["samples include a nonnumeric value", "18.6 x"]])(
    "returns null so the result is not judged when %s",
    (_label, text) => {
      expect(summarizeHeap(text)).toEqual({ min: null, spread: null, note: "", samples: [] });
    },
  );
});

describe("verdict scope without a baseline", () => {
  /** Realistic runner-scale values; cache_ms deliberately exceeds config.json bench.cacheMs. */
  const DETAIL = {
    cache_ms: 855.676, context_p99_bytes: 7602, context_p99_ms: 7.722,
    ratio_median: 19.572, scale10x: 7.47, tokens_p99_ms: 2.115,
  };

  it("judges only the host-independent items when the host has no baseline", () => {
    expect(judgedItems(true)).toEqual([
      "heapMb", "context_p99_bytes", "ratio_median", "scale10x",
      "agent_bytes_reduction_pct", "agent_expanded_samples", "variant_bytes_reduction_pct",
      "discovery_bytes", "discovery_returned", "mcp_schema_tokens", "mcp_tool_count",
    ]);
  });

  it("judges every measured item once the host has a baseline", () => {
    expect(judgedItems(false)).toEqual(Object.keys(THRESHOLD_OWNERS).sort());
  });

  it("treats projection and cache timing as host-dependent and byte sizes as host-independent", () => {
    const dependent = Object.keys(THRESHOLD_OWNERS).filter((i) => !ENV_INDEPENDENT.includes(i)).sort();
    expect(dependent).toEqual(["agent_p99_ms", "cache_ms", "context_p99_ms", "tokens_p99_ms"]);
    expect(ENV_INDEPENDENT).toHaveLength(Object.keys(THRESHOLD_OWNERS).length - dependent.length);
  });

  it("records the host-dependent items beside their owning threshold keys when unjudged", () => {
    expect(recordedItems(DETAIL, judgedItems(true), THRESHOLD_OWNERS)).toEqual({
      agent_p99_ms: { threshold: "config.json bench.agentWarmP99Ms", value: null },
      cache_ms: { threshold: "config.json bench.cacheMs", value: 855.676 },
      context_p99_ms: { threshold: "config.json bench.contextWarmP99Ms", value: 7.722 },
      tokens_p99_ms: { threshold: "config.json bench.tokensP99Ms", value: 2.115 },
    });
  });

  it("records no unjudged items when the environment can judge everything", () => {
    expect(recordedItems(DETAIL, judgedItems(false), THRESHOLD_OWNERS)).toEqual({});
  });

  it("keeps an unmeasured item present with a null value", () => {
    const recorded = recordedItems({ ...DETAIL, cache_ms: null }, judgedItems(true), THRESHOLD_OWNERS);
    expect(recorded.cache_ms).toEqual({ threshold: "config.json bench.cacheMs", value: null });
  });

  it("records owning key names without copying numeric thresholds", () => {
    for (const key of Object.values(THRESHOLD_OWNERS)) expect(key).toMatch(/^bench\.[A-Za-z0-9]+$/);
  });
});
