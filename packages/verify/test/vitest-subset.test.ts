// Fix for the trap in sharing one Vitest run across the tests, properties, rules, and scoring gates: a failure outside a
// gate's own pattern must never reach that gate.
import { describe, expect, it } from "vitest";
import {
  collectTitles,
  missingRuleIds,
  subsetVitestRun,
  vitestWorkerArgs,
  type VitestJson,
  type VitestRun,
} from "../src/gates/tests";

/** Shapes match the installed Vitest JSON reporter: an absolute file name per suite. */
const report = (files: { name: string; cases: { title: string; status: string }[] }[]): VitestJson => ({
  testResults: files.map((f) => ({ name: `/repo/${f.name}`, status: "passed", assertionResults: f.cases })),
});

/** `total` stays a whole-run count because only the tests gate reads it, and it never narrows. */
const run = (files: { name: string; cases: { title: string; status: string }[] }[]): VitestRun => ({
  ...collectTitles(report(files), "/repo"),
  total: files.reduce((n, f) => n + f.cases.length, 0),
  propertyEvidence: [{ id: "P01", runs: 300 }],
});

const fullSuite = run([
  { name: "packages/schema/test/failing.test.ts", cases: [{ title: "unrelated case", status: "failed" }] },
  { name: "packages/tokens/test/token.props.test.ts", cases: [{ title: "P01 round-trips", status: "passed" }] },
  { name: "packages/parser/test/naming.rules.test.ts", cases: [{ title: "R09: unbound colour", status: "passed" }] },
  { name: "packages/eval/test/score.adversarial.test.ts", cases: [{ title: "A01 rejects a handwritten number", status: "passed" }] },
]);

describe("Vitest worker arguments", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["3", ["--minWorkers=3", "--maxWorkers=3"]],
    ["0", ["--minWorkers=0", "--maxWorkers=0"]],
    ["-2", ["--minWorkers=-2", "--maxWorkers=-2"]],
    ["many", ["--minWorkers=many", "--maxWorkers=many"]],
  ] as const)("maps raw value %s to the expected argv", (raw, expected) => {
    expect(vitestWorkerArgs(raw)).toEqual(expected);
  });

  it("pins min and max together so Tinypool does not reject a lone maxWorkers=1", () => {
    expect(vitestWorkerArgs("1")).toEqual(["--minWorkers=1", "--maxWorkers=1"]);
  });
});

describe("narrowed view of one full Vitest run", () => {
  it.each(["props.test", "rules.test", "adversarial.test"])(
    "keeps an unrelated file's failure out of the %s subset", (pattern) => {
      expect(subsetVitestRun(fullSuite, pattern).failed).toBe(0);
    });

  it("counts a failure that is inside the pattern", () => {
    const suite = run([
      { name: "packages/schema/test/failing.test.ts", cases: [{ title: "unrelated case", status: "failed" }] },
      { name: "packages/tokens/test/token.props.test.ts", cases: [{ title: "P01 round-trips", status: "failed" }] },
    ]);

    expect(subsetVitestRun(suite, "props.test").failed).toBe(1);
  });

  it("derives passed and failed outcomes only from files matching the pattern", () => {
    const suite = run([
      { name: "packages/schema/test/unrelated.test.ts", cases: [
        { title: "unrelated pass", status: "passed" },
        { title: "unrelated failure", status: "failed" },
      ] },
      { name: "packages/tokens/test/token.props.test.ts", cases: [
        { title: "P01 passes", status: "passed" },
        { title: "P02 fails", status: "failed" },
      ] },
    ]);
    const subset = subsetVitestRun(suite, "props.test");

    expect({
      subset: { passed: subset.passed, failed: subset.failed, titles: subset.titles, executedTitles: subset.executedTitles },
      whole: { passed: suite.passed, failed: suite.failed, titles: suite.titles, executedTitles: suite.executedTitles },
    }).toEqual({
      subset: { passed: 1, failed: 1, titles: ["P01 passes"], executedTitles: ["P01 passes", "P02 fails"] },
      whole: {
        passed: 2,
        failed: 2,
        titles: ["unrelated pass", "P01 passes"],
        executedTitles: ["unrelated pass", "unrelated failure", "P01 passes", "P02 fails"],
      },
    });
  });

  it("selects only the files whose root-relative path contains the pattern", () => {
    expect(subsetVitestRun(fullSuite, "props.test").files.map((f) => f.name))
      .toEqual(["packages/tokens/test/token.props.test.ts"]);
  });

  it("keeps rule coverage identical to a run narrowed by Vitest itself", () => {
    const subset = subsetVitestRun(fullSuite, "rules.test");

    expect({ executed: subset.executedTitles, missing: missingRuleIds(["R09"], subset.executedTitles) })
      .toEqual({ executed: ["R09: unbound colour"], missing: [] });
  });

  it("keeps adversarial titles limited to the adversarial file", () => {
    expect(subsetVitestRun(fullSuite, "adversarial.test").titles).toEqual(["A01 rejects a handwritten number"]);
  });

  it("attributes a skipped case to its own file only", () => {
    const suite = run([
      { name: "packages/schema/test/skipped.test.ts", cases: [{ title: "unrelated case", status: "skipped" }] },
      { name: "packages/parser/test/naming.rules.test.ts", cases: [{ title: "R09: unbound colour", status: "passed" }] },
    ]);

    expect(subsetVitestRun(suite, "rules.test").skipped).toBe(0);
  });

  it("leaves property evidence whole so the properties gate still sees every generated case", () => {
    expect(subsetVitestRun(fullSuite, "props.test").propertyEvidence).toEqual([{ id: "P01", runs: 300 }]);
  });

  it("yields an empty subset rather than the whole run when no file matches", () => {
    const subset = subsetVitestRun(fullSuite, "bench.test");

    expect({ files: subset.files, titles: subset.titles, failed: subset.failed })
      .toEqual({ files: [], titles: [], failed: 0 });
  });
});
