// Which self-test samples can physically move a benchmark, and therefore run the benchmark gate.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { GateIdT } from "@tokenloom/schema";
import { listSamples, runsBenchmarks, touchesProductionSrc, type Sample } from "../src/gates/meta";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "tl-benchmark-scope-"));
afterAll(() => { rmSync(fixtureRoot, { recursive: true, force: true }); });

/** Builds one sample directory from the overlay paths it applies and the paths it removes. */
function sample(gate: GateIdT, name: string, applied: string[], removed: string[] = []): Sample {
  const dir = join(fixtureRoot, gate, name);
  for (const rel of applied) {
    const target = join(dir, "apply", rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "// fixture\n", "utf8");
  }
  if (removed.length > 0) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "remove.txt"), `# 지울 경로\n\n${removed.join("\n")}\n`, "utf8");
  }
  mkdirSync(dir, { recursive: true });
  return { gate, name, dir };
}

describe("touchesProductionSrc", () => {
  it.each([
    ["packages/tokens/src/jitter.ts", true],
    ["packages/adapters/plugin/src/code.ts", true],
    ["apps/cli/src/cmd-tokens.ts", true],
    ["packages/schema/src/deep/nested/escape-hatch.ts", true],
    // A remove.txt entry may name the whole source directory, which reaches a benchmark just as well.
    ["packages/parser/src", true],
    ["packages/parser/test/parser.props.test.ts", false],
    // src exists here, but not directly under a package or app, so no build output depends on it.
    ["packages/parser/test/src/helper.ts", false],
    ["packages/eval/package.json", false],
    ["package.json", false],
    ["samples/manifest.json", false],
    ["docs/reference/spec.md", false],
    ["docs/src/note.md", false],
  ])("classifies %s as production source: %s", (path, expected) => {
    expect(touchesProductionSrc([path])).toBe(expected);
  });

  it("classifies a sample that changes nothing as outside production source", () => {
    expect(touchesProductionSrc([])).toBe(false);
  });

  it("classifies a mixed overlay by its one production source path", () => {
    expect(touchesProductionSrc(["docs/reference/spec.md", "packages/tokens/src/jitter.ts"])).toBe(true);
  });
});

describe("runsBenchmarks", () => {
  it("runs the timing gate on its own owner sample even when the overlay changes only docs", () => {
    expect(runsBenchmarks(sample("benchmarks", "owner-docs-overlay", ["docs/reference/spec.md"]))).toBe(true);
  });

  it("runs the timing gate on a sample whose overlay changes production source", () => {
    expect(runsBenchmarks(sample("patterns", "src-overlay", ["packages/tokens/src/jitter.ts"]))).toBe(true);
  });

  it("runs the timing gate on a sample whose overlay changes nested production source", () => {
    expect(runsBenchmarks(sample("types", "nested-src-overlay", ["packages/schema/src/deep/escape-hatch.ts"]))).toBe(true);
  });

  it("runs the timing gate when a normalized remove.txt path deletes production source", () => {
    expect(runsBenchmarks(sample("properties", "src-removal", [], ["./packages//parser/src/delta.ts"]))).toBe(true);
  });

  it("skips the timing gate on a docs-only overlay", () => {
    expect(runsBenchmarks(sample("encoding", "docs-overlay", ["docs/reference/crlf-sample.md"]))).toBe(false);
  });

  it("skips the timing gate on a manifest-only overlay", () => {
    expect(runsBenchmarks(sample("scope", "manifest-overlay", ["packages/eval/package.json"]))).toBe(false);
  });

  it("skips the timing gate when remove.txt deletes only documentation", () => {
    expect(runsBenchmarks(sample("encoding", "docs-removal", [], ["docs/reference/spec.md"]))).toBe(false);
  });

  it("skips the timing gate on a sample with neither an overlay nor a remove list", () => {
    expect(runsBenchmarks(sample("rules", "no-overlay", []))).toBe(false);
  });
});

/**
 * The samples whose mutation can physically reach a benchmark. Listed by name so adding a sample
 * places it in a bucket knowingly rather than silently joining the cheaper side.
 */
const RUNS_BENCHMARKS_AT_HEAD = [
  "benchmarks/agent-expands-context",
  "benchmarks/quadratic-scale",
  "determinism/agent-clock-in-output",
  "determinism/clock-in-stdout",
  "mutations/agent-empty-silent",
  "mutations/silent-unbound-color",
  "patterns/empty-catch",
  "patterns/math-random",
  "properties/agent-mutates-canonical",
  "properties/broken-applydelta",
  "scoring/numeric-literal",
  "scoring/trajectory-handwritten-number",
  "types/any-type",
  "types/plugin-code-type-error",
];

const head = listSamples(repoRoot());
/** The self-test empties verify/selftest inside its copies, so the split is asserted only in the real tree. */
const headRuns = head.length === 0 ? [] : [[head] as const];

describe.each(headRuns)("self-test samples at HEAD", (samples) => {
  const id = (s: Sample): string => `${s.gate}/${s.name}`;

  it("runs the benchmark gate on exactly the samples that change production source", () => {
    expect(samples.filter(runsBenchmarks).map(id).sort()).toEqual(RUNS_BENCHMARKS_AT_HEAD);
  });

  it("splits every sample into exactly one bucket", () => {
    const skipped = samples.filter((s) => !runsBenchmarks(s)).map(id);

    expect({ total: samples.length, skipped: skipped.length })
      .toEqual({ total: RUNS_BENCHMARKS_AT_HEAD.length + skipped.length, skipped: samples.length - RUNS_BENCHMARKS_AT_HEAD.length });
  });
});
