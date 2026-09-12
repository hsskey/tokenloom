// Ensures the verification contract's section 8 table matches the verify/selftest tree.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSamples } from "../src/gates/meta";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

/**
 * Extracts gate and sample-directory names from section 8 rows. Both columns are backticked, and the
 * gate name must match listSamples so correctly written rows cannot silently disappear from comparison.
 */
export function parseSampleTable(markdown: string): Array<{ gate: string; sample: string }> {
  const section = markdown.split("\n## ").find((s) => s.startsWith("8. ")) ?? "";
  return section.split("\n").flatMap((line) => {
    const row = /^\|\s*`([a-z-]+)`\s*\|\s*`([^`]+)`/.exec(line);
    return row === null ? [] : [{ gate: row[1] as string, sample: row[2] as string }];
  });
}

function byGate(pairs: Array<{ gate: string; sample: string }>): Record<string, string[]> {
  return pairs.reduce<Record<string, string[]>>(
    (acc, { gate, sample }) => ({ ...acc, [gate]: [...(acc[gate] ?? []), sample].sort() }),
    {},
  );
}

const root = repoRoot();
const table = byGate(parseSampleTable(readFileSync(join(root, "docs/reference/verification.md"), "utf8")));
const tree = byGate(listSamples(root).map((s) => ({ gate: s.gate, sample: s.name })));
/**
 * The self-test gate empties verify/selftest in copies to prevent recursion. Copies therefore omit
 * tree comparison and retain only the table parser checks below.
 */
const treeGates = Object.keys(tree);
const gates = treeGates.length === 0 ? [] : [...new Set([...Object.keys(table), ...treeGates])].sort();

describe("parseSampleTable", () => {
  it("reads only the first backticked sample name and ignores backticks in its description", () => {
    const md = "# TESTS\n## 8. 샘플\n| `types` | `any-type` | `: any`가 있는 파일 |\n| 게이트 | 샘플 |\n## 9. 다음";
    expect(parseSampleTable(md)).toEqual([{ gate: "types", sample: "any-type" }]);
  });

  it("ignores similarly shaped rows outside section 8", () => {
    expect(parseSampleTable("# TESTS\n## 2. 게이트\n| `types` | `any-type` | 설명 |\n")).toEqual([]);
  });
});

describe("verification contract section 8 table and verify/selftest tree", () => {
  // This comparison still runs in copies and catches a deleted table or missing gate row.
  it("lists samples for every gate that a defect sample can break", () => {
    expect(Object.keys(table).sort()).toEqual([
      "benchmarks", "determinism", "encoding", "mutations", "patterns", "properties",
      "reference", "rules", "scope", "scoring", "tests", "types",
    ]);
  });

  it.each(gates)("matches %s sample directories between the table and tree", (gate) => {
    expect(table[gate] ?? []).toEqual(tree[gate] ?? []);
  });
});
