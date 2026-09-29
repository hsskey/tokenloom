// Fail-closed aggregate for the non-authoritative shard experiment: green only for a complete, bound, passing set.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { GateIdT, HostGateResultsT, ShardFragmentT, ShardSampleT } from "@tokenloom/schema";
import { HOST_GATES, HostGateResults, ShardFragment } from "@tokenloom/schema";
import {
  aggregateShards, collectAggregateInput, fragmentArtifact, HOST_ARTIFACT, parseShardCount, readRecordSlot, RECORD_FILE,
  type AggregateInput,
} from "../src/shard-aggregate";
import { makeVerifyContext } from "../src/verify-context";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const scratchDirs: string[] = [];
afterAll(() => scratchDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tl-shard-aggregate-"));
  scratchDirs.push(dir);
  return dir;
}

const A40 = "a".repeat(40);
const B40 = "b".repeat(40);
const PROVENANCE = { sha: A40, runId: "101", runAttempt: "1" };
const SHARDS = 2;
const IDS = HOST_GATES.map((gate) => `${gate}/sample`);
const REACHABLE: Record<string, GateIdT[]> = Object.fromEntries(HOST_GATES.map((gate) => [`${gate}/sample`, [gate]]));
const CHECKS = ["producers", "fragments", "provenance", "baseline", "sample-union", "sample-verdicts", "reachability", "host-gates"];

const sampleOf = (id: string): ShardSampleT => ({ id, asExpected: true, detail: "ok", reachable: REACHABLE[id] ?? [] });

function fragmentOf(index: number, overrides: Partial<ShardFragmentT> = {}): ShardFragmentT {
  return {
    kind: "shard-fragment",
    shardIndex: index,
    shardCount: SHARDS,
    ...PROVENANCE,
    baselinePass: true,
    samples: IDS.filter((_, position) => position % SHARDS === index).map(sampleOf),
    timing: { totalMs: 1 },
    ...overrides,
  };
}

const samplesOf = (index: number): ShardSampleT[] => fragmentOf(index).samples;
const hostOf = (gates: GateIdT[]): HostGateResultsT => Object.fromEntries(gates.map((gate) => [gate, { pass: true }]));

function inputOf(overrides: Partial<AggregateInput> = {}): AggregateInput {
  return {
    shardCount: SHARDS,
    provenance: PROVENANCE,
    canonical: { ids: IDS, reachable: REACHABLE },
    host: { record: hostOf(HOST_GATES) },
    fragments: [{ record: fragmentOf(0) }, { record: fragmentOf(1) }],
    jobs: { host: "success", shard: "success" },
    ...overrides,
  };
}

const withFragments = (first: ShardFragmentT, second: ShardFragmentT): AggregateInput =>
  inputOf({ fragments: [{ record: first }, { record: second }] });

const failedChecks = (input: AggregateInput): Array<[string, string]> =>
  aggregateShards(input).checks.filter((c) => !c.pass).map((c) => [c.name, c.detail]);

describe("aggregateShards", () => {
  it("is green, and still non-authoritative, when every record is present, bound, and passing", () => {
    expect(aggregateShards(inputOf())).toEqual({
      kind: "shard-aggregate",
      authoritative: false,
      green: true,
      ...PROVENANCE,
      shardCount: SHARDS,
      checks: CHECKS.map((name) => ({ name, pass: true, detail: "ok" })),
    });
  });

  it.each<[string, () => AggregateInput, Array<[string, string]>]>([
    ["a sample is missing from the union",
      () => withFragments(fragmentOf(0), fragmentOf(1, { samples: samplesOf(1).slice(0, -1) })),
      [["sample-union", "missing encoding/sample"]]],
    ["a sample runs in two shards",
      () => withFragments(fragmentOf(0), fragmentOf(1, { samples: [...samplesOf(1), sampleOf("types/sample")] })),
      [["sample-union", "duplicate types/sample"]]],
    ["a shard reports a sample the source does not have",
      () => withFragments(fragmentOf(0, { samples: [...samplesOf(0), { ...sampleOf("types/sample"), id: "types/ghost" }] }), fragmentOf(1)),
      [["sample-union", "unexpected types/ghost"]]],
    ["the revision has no self-test samples",
      () => inputOf({ canonical: { ids: [], reachable: REACHABLE } }),
      [["sample-union", "no self-test samples at this revision"]]],
    ["the revision has no sample for one host gate",
      () => ({
        ...withFragments(fragmentOf(0), fragmentOf(1, { samples: samplesOf(1).filter((s) => s.id !== "scope/sample") })),
        canonical: { ids: IDS.filter((id) => id !== "scope/sample"), reachable: REACHABLE },
      }),
      [["sample-union", "no self-test sample for scope"]]],
    ["a sample is not as expected",
      () => withFragments(fragmentOf(0, {
        samples: [{ ...sampleOf("types/sample"), asExpected: false, detail: "types did not fail" }, ...samplesOf(0).slice(1)],
      }), fragmentOf(1)),
      [["sample-verdicts", "types/sample: types did not fail"]]],
    ["a sample ran a different gate set than the source reaches",
      () => withFragments(fragmentOf(0, {
        samples: [{ ...sampleOf("types/sample"), reachable: ["types", "tests"] }, ...samplesOf(0).slice(1)],
      }), fragmentOf(1)),
      [["reachability", "types/sample: ran types,tests but the source reaches types"]]],
    ["one shard's clean copy fails",
      () => withFragments(fragmentOf(0), fragmentOf(1, { baselinePass: false })),
      [["baseline", "shard 1: clean copy failed"]]],
    ["a host gate fails",
      () => inputOf({ host: { record: { ...hostOf(HOST_GATES), tests: { pass: false, reason: "1 failed" } } } }),
      [["host-gates", "tests: 1 failed"]]],
    ["a host gate did not run",
      () => inputOf({ host: { record: { ...hostOf(HOST_GATES), benchmarks: { pass: null } } } }),
      [["host-gates", "benchmarks: pass null"]]],
    ["a host gate result is missing",
      () => inputOf({ host: { record: hostOf(HOST_GATES.filter((gate) => gate !== "scope")) } }),
      [["host-gates", "scope: missing"]]],
    ["the host record is absent",
      () => inputOf({ host: { missing: "absent" } }),
      [["host-gates", "host record absent"]]],
    ["a fragment was produced at another revision",
      () => withFragments(fragmentOf(0), fragmentOf(1, { sha: B40 })),
      [["provenance", `shard 1: sha ${B40} differs from ${A40}`]]],
    ["a fragment was produced by another run",
      () => withFragments(fragmentOf(0), fragmentOf(1, { runId: "202" })),
      [["provenance", "shard 1: runId 202 differs from 101"]]],
    ["a rerun mixes run attempts",
      () => withFragments(fragmentOf(0, { runAttempt: "2" }), fragmentOf(1)),
      [["provenance", "shard 0: runAttempt 2 differs from 1"]]],
    ["fragments sit in each other's slots",
      () => withFragments(fragmentOf(1), fragmentOf(0)),
      [["fragments", "shard 0: declares 1/2; shard 1: declares 0/2"]]],
    ["a fragment declares another shard count",
      () => withFragments(fragmentOf(0), fragmentOf(1, { shardCount: 3 })),
      [["fragments", "shard 1: declares 1/3"]]],
    ["a shard job failed after uploading a passing fragment",
      () => inputOf({ jobs: { host: "success", shard: "failure" } }),
      [["producers", "shard job concluded failure"]]],
    ["the host job was cancelled",
      () => inputOf({ jobs: { host: "cancelled", shard: "success" } }),
      [["producers", "host job concluded cancelled"]]],
    ["the producer jobs were skipped",
      () => inputOf({ jobs: { host: "skipped", shard: "skipped" } }),
      [["producers", "host job concluded skipped; shard job concluded skipped"]]],
    ["no producer result reached the aggregate",
      () => inputOf({ jobs: { host: "", shard: "" } }),
      [["producers", "host job concluded absent; shard job concluded absent"]]],
  ])("is red with one diagnostic when %s", (_, build, expected) => {
    expect(failedChecks(build())).toEqual(expected);
  });

  it.each<[string, AggregateInput, string]>([
    ["never downloaded", inputOf({ fragments: [{ record: fragmentOf(0) }] }), "shard 1: absent"],
    ["unusable", inputOf({ fragments: [{ record: fragmentOf(0) }, { missing: "empty" }] }), "shard 1: empty"],
  ])("is red when a fragment is %s, and names the samples it would have covered", (_, input, presence) => {
    expect(failedChecks(input)).toEqual([
      ["fragments", presence],
      ["sample-union", samplesOf(1).map((s) => `missing ${s.id}`).join("; ")],
    ]);
  });
});

describe("parseShardCount", () => {
  it("reads a positive shard count", () => {
    expect(parseShardCount("4")).toBe(4);
  });

  it.each([undefined, "", "0", "-1", "2.5", "four"])("rejects %j", (raw) => {
    expect(() => parseShardCount(raw)).toThrow("--aggregate requires --shards <positive integer>");
  });
});

describe("readRecordSlot", () => {
  function recordPath(content: string | undefined): string {
    const path = join(scratchDir(), RECORD_FILE);
    if (content !== undefined) writeFileSync(path, content);
    return path;
  }

  it.each<[string, string | undefined, { missing: string }]>([
    ["absent", undefined, { missing: "absent" }],
    ["empty", "", { missing: "empty" }],
    ["blank", " \n", { missing: "empty" }],
    ["missing a required field", "{\"kind\":\"shard-fragment\"}", { missing: "invalid: shardIndex Required" }],
  ])("reports a fragment that is %s", (_, content, expected) => {
    expect(readRecordSlot(recordPath(content), ShardFragment)).toEqual(expected);
  });

  it("reports a fragment that is not JSON", () => {
    expect(readRecordSlot(recordPath("{\"kind\":"), ShardFragment)).toEqual({ missing: expect.stringMatching(/^unparseable: /) });
  });

  it("reports a host record whose gate result has no verdict", () => {
    expect(readRecordSlot(recordPath("{\"types\":{\"reason\":\"x\"}}"), HostGateResults))
      .toEqual({ missing: "invalid: types.pass Required" });
  });

  it("returns a valid fragment unchanged", () => {
    expect(readRecordSlot(recordPath(JSON.stringify(fragmentOf(0))), ShardFragment)).toEqual({ record: fragmentOf(0) });
  });
});

describe("shard artifact layout", () => {
  it("uses the artifact and file names that .github/workflows/verify-shard.yml uploads", () => {
    expect({ host: HOST_ARTIFACT, fragment: fragmentArtifact(2, 4), file: RECORD_FILE })
      .toEqual({ host: "verify-shard-host", fragment: "verify-shard-2-of-4", file: "record.json" });
  });
});

describe("collectAggregateInput", () => {
  function artifactsDir(records: Record<string, unknown>): string {
    const dir = scratchDir();
    for (const [artifact, record] of Object.entries(records)) {
      mkdirSync(join(dir, artifact), { recursive: true });
      writeFileSync(join(dir, artifact, RECORD_FILE), JSON.stringify(record));
    }
    return dir;
  }

  it("reads the host record, every fragment slot, and producer results from the downloaded layout", () => {
    const dir = artifactsDir({ [HOST_ARTIFACT]: hostOf(HOST_GATES), [fragmentArtifact(0, SHARDS)]: fragmentOf(0) });
    const env = {
      GITHUB_RUN_ID: "101", GITHUB_RUN_ATTEMPT: "1",
      TOKENLOOM_SHARD_HOST_RESULT: "success", TOKENLOOM_SHARD_FRAGMENTS_RESULT: "failure",
    };

    const input = collectAggregateInput(makeVerifyContext(repoRoot()), dir, SHARDS, env);

    expect({ host: input.host, fragments: input.fragments, jobs: input.jobs }).toEqual({
      host: { record: hostOf(HOST_GATES) },
      fragments: [{ record: fragmentOf(0) }, { missing: "absent" }],
      jobs: { host: "success", shard: "failure" },
    });
  });

  it("refuses to aggregate without the workflow run binding", () => {
    expect(() => collectAggregateInput(makeVerifyContext(repoRoot()), scratchDir(), SHARDS, {}))
      .toThrow("shard records require GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT");
  });

  it("binds the record to the full revision under test and the run attempt", () => {
    const { provenance } = collectAggregateInput(
      makeVerifyContext(repoRoot()), scratchDir(), SHARDS, { GITHUB_RUN_ID: "7", GITHUB_RUN_ATTEMPT: "2" },
    );

    expect({ ...provenance, sha: /^[0-9a-f]{40}$/.test(provenance.sha) }).toEqual({ sha: true, runId: "7", runAttempt: "2" });
  });
});
