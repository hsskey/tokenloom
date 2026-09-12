// Requires source annotations for performance, cost, and limit numbers in both README files.
// The source file must contain the number so a valid path cannot legitimize an incorrect value.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Detects decimals, currency, and unit-bearing integers that read as performance, cost, or limits.
 * Dates, gate/phase IDs, versions, flag values, SPEC section numbers, and license versions are excluded.
 */
const UNITS = [
  "ms|MB|KB|B|%|배|초|회|개|줄|분|일|토큰",
  // Units used in the same positions by the English README.
  "s|x|tokens?|tests?|lines?|calls?|days?",
].join("|");
const NUMBER = new RegExp(
  [
    String.raw`\$\s*\d[\d,]*(?:\.\d+)?`,
    String.raw`(?<![\w.])(?<!section )(?<!CC BY )\d[\d,]*\.\d+(?![.\d])(?!\s*절)`,
    String.raw`(?<![\w.])\d[\d,]*\/?\s*(?:${UNITS})(?![A-Za-z])`,
  ].join("|"),
  "g",
);
const SOURCE = /<!--\s*source:\s*(\S+)\s*-->/;

/** Allowed source roots for measurements, aggregates, and design evidence. */
const ALLOWED_SOURCES = [
  "verify/", "bench/", "runs/", "reports/", "docs/reference/spec.md", "docs/goals.md",
];

/** Applies the same source check to the canonical Korean README and its English translation. */
const READMES = ["README.ko.md", "README.md"];

export interface NumberLine {
  line: number;
  numbers: string[];
  source: string | null;
}

/** Returns only lines with measured numbers, excluding digits inside the source-annotation path. */
export function scanNumberLines(text: string): NumberLine[] {
  return text.split("\n").flatMap((raw, i) => {
    const source = SOURCE.exec(raw);
    const numbers = [...raw.replace(SOURCE, "").matchAll(NUMBER)].map((m) =>
      m[0].replace(/[^\d.]/g, ""),
    );
    return numbers.length === 0 ? [] : [{ line: i + 1, numbers, source: source?.[1] ?? null }];
  });
}

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

/** Formats human-readable violations for one line, or an empty list when valid. */
function violationsOf(root: string, file: string, hit: NumberLine): string[] {
  const at = `${file}:${hit.line} (${hit.numbers.join(", ")})`;
  if (hit.source === null) return [`${at}: missing source annotation <!-- source: <path> -->`];
  if (!ALLOWED_SOURCES.some((prefix) => hit.source?.startsWith(prefix))) {
    return [`${at}: disallowed source ${hit.source} (allowed: ${ALLOWED_SOURCES.join(", ")})`];
  }
  const path = join(root, hit.source);
  if (!existsSync(path)) return [`${at}: source file does not exist: ${hit.source}`];
  const body = readFileSync(path, "utf8").replace(/,/g, "");
  return hit.numbers.filter((n) => !body.includes(n)).map((n) => `${at}: ${hit.source} does not contain ${n}`);
}

describe("scanNumberLines", () => {
  it.each([
    ["`context` compact 웜 p99 1.063ms", ["1.063"]],
    ["압축비 중앙값 19.572배", ["19.572"]],
    ["세트당 $2.2986", ["2.2986"]],
    ["10k 노드 힙 18.6MB", ["18.6"]],
    ["테스트 441개 통과", ["441"]],
    ["Starter의 REST Tier 1 예산은 월 20회다", ["20"]],
    ["compact design context 크기 p99 7602B", ["7602"]],
    ["REST Tier 1은 10/분이다", ["10"]],
    ["벽시계 194초", ["194"]],
    ["입력 토큰 p50 5315토큰", ["5315"]],
    ["input tokens p50 5315 tokens", ["5315"]],
    ["441 tests passed", ["441"]],
    ["6638 lines of source", ["6638"]],
    ["194s wall clock", ["194"]],
    ["20 calls per month", ["20"]],
    ["예산의 83%", ["83"]],
    ["83% of the budget", ["83"]],
  ])("detects performance number in %s", (text, expected) => {
    expect(scanNumberLines(text).flatMap((h) => h.numbers)).toEqual(expected);
  });

  it.each([
    "측정일은 2026-09-04다",
    "버전 v2와 depth 4",
    "버전 v0.0.0",
    "Node 22 이상",
    "발견 깊이는 --depth 4다",
    "`docs/reference/spec.md` 4.9절",
    "verify/P4-2026-09-04T04-21-58Z.json",
    "`docs/reference/spec.md` section 4.9",
    "20 sets on one page",
    "CC BY 4.0 라이선스의 커뮤니티 파일",
    "a Community file under CC BY 4.0",
  ])("ignores non-performance number in %s", (text) => {
    expect(scanNumberLines(text)).toEqual([]);
  });

  it("returns the path from a source annotation", () => {
    expect(scanNumberLines("힙 18.6MB <!-- source: bench/results.jsonl -->")).toEqual([
      { line: 1, numbers: ["18.6"], source: "bench/results.jsonl" },
    ]);
  });

  it("returns a null source when the annotation is absent", () => {
    expect(scanNumberLines("힙 18.6MB")).toEqual([{ line: 1, numbers: ["18.6"], source: null }]);
  });
});

describe("README", () => {
  it.each(READMES)("requires every performance, cost, and limit number in %s to exist in an allowed source", (file) => {
    const root = repoRoot();
    const readme = readFileSync(join(root, file), "utf8");
    const violations = scanNumberLines(readme).flatMap((hit) => violationsOf(root, file, hit));
    expect(violations, `README numbers must be copied from their sources:\n${violations.join("\n")}`).toEqual([]);
  });
});
