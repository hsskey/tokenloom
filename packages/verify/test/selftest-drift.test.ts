// Each scoring sample is a full copy of a report source plus its injections. When the source
// changes, the stale copy can break the type gate before the scoring gate is evaluated. This check
// runs in the fast CI job so the drift surfaces before the full job spends minutes on the self-test.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSamples } from "../src/gates/meta";

const SOURCE = "packages/eval/src/report.ts";
const SAMPLE = "verify/selftest/scoring/numeric-literal/apply/packages/eval/src/report.ts";

/**
 * Two regions injected into report.ts by the sample, located by identifiers rather than copied values.
 */
const INJECTED = [
  /^const S2_THRESHOLD = .*;\n\n/m,
  /^export function passesS2\([\s\S]*?\n}\n\n/m,
];

export function stripRegions(sample: string, regions: RegExp[]): string {
  return regions.reduce((text, region) => text.replace(region, ""), sample);
}

export function stripInjection(sample: string): string {
  return stripRegions(sample, INJECTED);
}

/** Reports only the first differing line so failure output remains readable. */
export function firstDiff(actual: string, expected: string): string {
  const a = actual.split("\n");
  const e = expected.split("\n");
  const at = [...Array(Math.max(a.length, e.length)).keys()].find((i) => a[i] !== e[i]);
  return at === undefined ? "" : `line ${at + 1}: left ${JSON.stringify(a[at] ?? null)} != right ${JSON.stringify(e[at] ?? null)}`;
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

const root = repoRoot();
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

/**
 * The self-test gate empties verify/selftest in copies to prevent recursion. Real-file comparison
 * therefore runs only in the original repository; copies use it.each([]) to create no cases without
 * forbidden skip calls.
 */
const realTree = listSamples(root).length === 0 ? [] : [SAMPLE];

/** Minimal pre/post-injection copies independent of report.ts and valid inside self-test copies. */
const WITHOUT = 'const A = "a";\n\nfunction row(): void {}\n\nfunction table(): void {}\n';
const WITH = 'const A = "a";\n\nconst S2_THRESHOLD = X;\n\nfunction row(): void {}\n\n'
  + "export function passesS2(value: number): boolean {\n  return value >= S2_THRESHOLD;\n}\n\n"
  + "function table(): void {}\n";

describe("scoring numeric-literal sample and report.ts", () => {
  it("matches the pre-injection file byte-for-byte after stripping both injected regions", () => {
    expect(firstDiff(stripInjection(WITH), WITHOUT)).toBe("");
  });

  it.each(realTree)("matches report.ts bytes after stripping injected regions from %s", (rel) => {
    expect(firstDiff(stripInjection(read(rel)), read(SOURCE))).toBe("");
  });

  it.each(realTree)("retains both injected regions in %s", (rel) => {
    expect(INJECTED.map((region) => region.test(read(rel)))).toEqual([true, true]);
  });
});

describe("stripInjection and firstDiff", () => {
  it("leaves a copy without injected regions unchanged", () => {
    expect(firstDiff(stripInjection(WITHOUT), WITHOUT)).toBe("");
  });

  it("identifies the first mismatch when a copy contains one extra line", () => {
    expect(firstDiff("a\nx\nb\n", "a\nb\n")).toBe('line 2: left "x" != right "b"');
  });
});

const TRAJECTORY_SOURCE = "packages/eval/src/trajectory-report.ts";
const TRAJECTORY_SAMPLE = "verify/selftest/scoring/trajectory-handwritten-number/apply/packages/eval/src/trajectory-report.ts";

/** The single injected region: the hand-written rate and the helper that prints it, located by identifier. */
const TRAJECTORY_INJECTED = [
  /^const HANDWRITTEN_SUCCESS_RATE = .*;\n\nexport function handwrittenSuccessRate\([\s\S]*?\n}\n\n/m,
];

const trajectoryTree = listSamples(root).length === 0 ? [] : [TRAJECTORY_SAMPLE];

/**
 * Drift protection only: the overlay copies trajectory-report.ts whole, so a stale copy fails the
 * type gate inside the self-test copy before the scoring gate is reached.
 * trajectory-evidence.test.ts proves the scoring gate's rejection.
 */
describe("scoring trajectory-handwritten-number sample and trajectory-report.ts", () => {
  it.each(trajectoryTree)("matches trajectory-report.ts bytes after stripping the injected region from %s", (rel) => {
    expect(firstDiff(stripRegions(read(rel), TRAJECTORY_INJECTED), read(TRAJECTORY_SOURCE))).toBe("");
  });
});

