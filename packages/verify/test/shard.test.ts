// Shard selection for the non-authoritative shard experiment: complete when unset, exact and disjoint when set.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selftestSamples } from "../src/gates/meta";
import { parseShardSelector, partitionByShard, requireShardSelector, sampleId } from "../src/shard";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const MALFORMED = ["4/4", "1/0", "0/0", "-1/4", "1.5/4", "1/4/2", "a/4", "1", "/4", "1 /4"];
const positions = Array.from({ length: 27 }, (_, position) => position);

describe("parseShardSelector", () => {
  it.each([undefined, "", "  "])("selects no shard for %j, keeping the complete sample set", (raw) => {
    expect(parseShardSelector(raw)).toBe(undefined);
  });

  it("reads a zero-based index and a count", () => {
    expect(parseShardSelector("3/4")).toEqual({ index: 3, count: 4 });
  });

  it.each(MALFORMED)("rejects %j instead of falling back to a complete or empty run", (raw) => {
    expect(() => parseShardSelector(raw)).toThrow(`invalid TOKENLOOM_SELFTEST_SHARD "${raw}"`);
  });
});

describe("requireShardSelector", () => {
  it.each([undefined, ""])("refuses to produce a fragment when the selector is %j", (raw) => {
    expect(() => requireShardSelector(raw)).toThrow("--shard-fragment requires TOKENLOOM_SELFTEST_SHARD");
  });

  it("returns the selected shard", () => {
    expect(requireShardSelector("0/4")).toEqual({ index: 0, count: 4 });
  });
});

describe("partitionByShard", () => {
  it("keeps every sample in order when no shard is selected", () => {
    expect(partitionByShard(positions, undefined)).toEqual(positions);
  });

  it("assigns each sorted position to the shard equal to position mod count", () => {
    const shards = [0, 1, 2, 3].map((index) => partitionByShard(positions, { index, count: 4 }));

    expect(shards).toEqual([
      [0, 4, 8, 12, 16, 20, 24],
      [1, 5, 9, 13, 17, 21, 25],
      [2, 6, 10, 14, 18, 22, 26],
      [3, 7, 11, 15, 19, 23],
    ]);
  });

  // Copies empty verify/selftest to prevent recursion, so this comparison is meaningful only on the host tree.
  it("places every committed self-test sample in exactly one of four shards", () => {
    const ids = selftestSamples(repoRoot()).map(sampleId);

    const union = [0, 1, 2, 3].flatMap((index) => partitionByShard(ids, { index, count: 4 }));

    expect(union.sort()).toEqual([...ids].sort());
  });
});
