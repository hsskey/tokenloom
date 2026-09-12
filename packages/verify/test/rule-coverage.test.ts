import { describe, expect, it } from "vitest";
import { collectTitles, missingRuleIds, type VitestJson } from "../src/gates/tests";

/**
 * Shapes match what the installed Vitest JSON reporter actually emits: a skipped case reports
 * `skipped` and a todo case reports `todo`, each still carrying its title.
 */
const report = (cases: { title: string; status: string }[]): VitestJson => ({
  testResults: [{ name: "rules.test.ts", status: "passed", assertionResults: cases }],
});

describe("executed-title collection", () => {
  it.each([
    { status: "passed", executed: true, passedOnly: true },
    { status: "failed", executed: true, passedOnly: false },
    { status: "skipped", executed: false, passedOnly: false },
    { status: "todo", executed: false, passedOnly: false },
  ])("counts a $status case as executed=$executed", ({ status, executed, passedOnly }) => {
    const { titles, executedTitles } = collectTitles(report([{ title: "R01: rule", status }]));

    expect(executedTitles).toEqual(executed ? ["R01: rule"] : []);
    expect(titles).toEqual(passedOnly ? ["R01: rule"] : []);
  });
});

describe("rule coverage from executed titles", () => {
  it("accepts a rule whose only test executed and failed, leaving the failure to the tests gate", () => {
    const { executedTitles } = collectTitles(report([{ title: "R09: unbound colour", status: "failed" }]));

    expect(missingRuleIds(["R09"], executedTitles)).toEqual([]);
  });

  it("accepts a rule when one case is skipped but another executed", () => {
    const { executedTitles } = collectTitles(report([
      { title: "R09: unbound colour", status: "skipped" },
      { title: "R09: hidden fills", status: "passed" },
    ]));

    expect(missingRuleIds(["R09"], executedTitles)).toEqual([]);
  });

  it("rejects a rule whose every case is skipped or todo", () => {
    const { executedTitles } = collectTitles(report([
      { title: "R09: unbound colour", status: "skipped" },
      { title: "R09: hidden fills", status: "todo" },
    ]));

    expect(missingRuleIds(["R09"], executedTitles)).toEqual(["R09"]);
  });

  it("rejects a rule that has no test at all", () => {
    const { executedTitles } = collectTitles(report([{ title: "R01: other rule", status: "passed" }]));

    expect(missingRuleIds(["R01", "R09"], executedTitles)).toEqual(["R09"]);
  });

  it("rejects every rule when the suite produced no report", () => {
    expect(missingRuleIds(["R01", "R09"], [])).toEqual(["R01", "R09"]);
  });

  it("does not let a substring of a longer identifier satisfy a rule", () => {
    const { executedTitles } = collectTitles(report([{ title: "R091: neighbouring rule", status: "passed" }]));

    expect(missingRuleIds(["R09"], executedTitles)).toEqual(["R09"]);
  });
});
