// Sample discovery, coverage accounting, and the recorded timing of the verifier self-test.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GateIdT } from "@tokenloom/schema";
import { ALL_GATES } from "@tokenloom/schema";
import {
  selftest, selftestCopyEnv, selftestTiming, resolveSelftestParallel, resolveSelftestVitestWorkers,
  scopeSamples, type Sample,
} from "../src/gates/meta";
import type { VerifyConfig } from "../src/verify-context";

const root = mkdtempSync(join(tmpdir(), "tl-selftest-test-"));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

function sample(gate: GateIdT, name: string): Sample {
  const dir = join(root, gate, name);
  mkdirSync(dir, { recursive: true });
  return { gate, name, dir };
}

const GATES: GateIdT[] = ["types", "benchmarks"];
const typeDefect = sample("types", "any-type");
const secondTypeDefect = sample("types", "plugin-code-type-error");
const benchDefect = sample("benchmarks", "quadratic-scale");

describe("scopeSamples", () => {
  it("runs every discovered sample, because no sample is scoped away", () => {
    const scoped = scopeSamples([typeDefect, secondTypeDefect, benchDefect], GATES);

    expect(scoped.run.map((s) => s.name)).toEqual(["any-type", "plugin-code-type-error", "quadratic-scale"]);
  });

  it("counts the defect samples that exercise each gate", () => {
    expect(scopeSamples([typeDefect, secondTypeDefect, benchDefect], GATES).coverage)
      .toEqual({ types: 2, benchmarks: 1 });
  });

  it("warns for a gate that no sample exercises", () => {
    const scoped = scopeSamples([typeDefect], ["types", "benchmarks", "encoding"]);

    expect({ coverage: scoped.coverage, warnings: scoped.coverageWarnings })
      .toEqual({ coverage: { types: 1, benchmarks: 0, encoding: 0 }, warnings: ["benchmarks", "encoding"] });
  });
});

/** A tree whose sample directories cover every gate but one, so the missing-sample check fires. */
function repoMissingSampleFor(gate: GateIdT): string {
  const dir = mkdtempSync(join(tmpdir(), "tl-selftest-repo-"));
  for (const other of ALL_GATES.filter((g) => g !== "selftest" && g !== gate)) {
    mkdirSync(join(dir, "verify/selftest", other, "defect"), { recursive: true });
  }
  return dir;
}

const repo = repoMissingSampleFor("benchmarks");
const workdir = join(tmpdir(), `tl-selftest-${process.pid}`);
afterAll(() => { rmSync(repo, { recursive: true, force: true }); });

describe("self-test sample requirement", () => {
  it("fails before creating copies when a gate has no defect sample", async () => {
    const result = await selftest({ root: repo, config: {} as VerifyConfig, files: [] });

    expect({ pass: result.pass, reason: result.reason, copies: existsSync(workdir) }).toEqual({
      pass: false,
      reason: "no selftest sample for benchmarks",
      copies: false,
    });
  });
});

// Six boundary marks in the order the self-test takes them: start, baseline prepared, baseline
// gated, samples prepared, parallel gated, serial gated.
const MARKS = [1_000, 1_550, 29_573, 44_545, 293_013, 438_424];

describe("self-test parallel width", () => {
  it.each([
    [undefined, 4],
    ["", 4],
    ["3", 3],
    ["0", 4],
    ["-2", 4],
    ["many", 4],
  ] as const)("resolves raw value %s to %i", (raw, expected) => {
    expect(resolveSelftestParallel(raw, 4)).toBe(expected);
  });
});

describe("self-test copy Vitest workers", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["1", "1"],
    ["3", "3"],
    ["0", undefined],
    ["-2", undefined],
    ["many", undefined],
  ] as const)("resolves raw value %s to %s", (raw, expected) => {
    expect(resolveSelftestVitestWorkers(raw)).toBe(expected);
  });

  it("pins copy workers without inheriting the host Vitest worker setting", () => {
    const env = selftestCopyEnv({
      PATH: "/bin",
      TOKENLOOM_VITEST_WORKERS: "8",
      TOKENLOOM_SELFTEST_VITEST_WORKERS: "1",
    });

    expect({ copy: env.TOKENLOOM_VITEST_WORKERS, host: env.TOKENLOOM_SELFTEST_VITEST_WORKERS }).toEqual({
      copy: "1", host: "1",
    });
  });

  it("clears a leaked host worker setting when the self-test knob is unset", () => {
    const env = selftestCopyEnv({ PATH: "/bin", TOKENLOOM_VITEST_WORKERS: "8" });
    expect(env.TOKENLOOM_VITEST_WORKERS).toBeUndefined();
  });
});

describe("self-test timing record", () => {
  it("reports each stage as the milliseconds between its own boundary marks", () => {
    expect(selftestTiming(MARKS)).toEqual({
      baselinePrepareMs: 550,
      baselineGatesMs: 28_023,
      samplePrepareMs: 14_972,
      parallelGatesMs: 248_468,
      serialBenchmarkMs: 145_411,
      totalMs: 437_424,
    });
  });

  it("records every stage as a non-negative integer", () => {
    const timing = selftestTiming(MARKS);

    expect(Object.values(timing).filter((ms) => !Number.isInteger(ms) || ms < 0)).toEqual([]);
  });

  it("reports only completed stages when a run stops after baseline gates", () => {
    expect(selftestTiming(MARKS.slice(0, 3))).toEqual({
      baselinePrepareMs: 550,
      baselineGatesMs: 28_023,
      totalMs: 28_573,
    });
  });
});
