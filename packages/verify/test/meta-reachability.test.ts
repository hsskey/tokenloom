// Self-test collateral reachability: skip a gate only when the overlay cannot change it.
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GateIdT } from "@tokenloom/schema";
import { ALL_GATES } from "@tokenloom/schema";
import {
  listSamples, reachableGates, sampleReachableGates, type GateSkip,
} from "../src/gates/meta";

const REQUIRED: GateIdT[] = ALL_GATES.filter((g) => g !== "selftest");

function unreachable(gates: GateIdT[]): GateSkip[] {
  return gates.map((gate) => ({ gate, reason: "unreachable" }));
}

describe("reachableGates", () => {
  it.each([
    [
      "a docs-history overlay",
      "encoding",
      ["docs/reference/crlf-sample.md"],
      unreachable(["types", "tests", "reference", "determinism", "properties", "mutations", "rules", "benchmarks", "scoring"]),
    ],
    [
      "a failing unit-test overlay",
      "tests",
      ["packages/schema/test/failing.test.ts"],
      unreachable(["reference", "determinism", "properties", "mutations", "rules", "benchmarks", "scoring"]),
    ],
    [
      "a property-test overlay",
      "properties",
      ["packages/parser/test/parser.props.test.ts"],
      unreachable(["reference", "determinism", "mutations", "rules", "benchmarks", "scoring"]),
    ],
    [
      "a rule-test overlay",
      "rules",
      ["packages/tokens/test/tokens.rules.test.ts"],
      unreachable(["reference", "determinism", "properties", "mutations", "benchmarks", "scoring"]),
    ],
    [
      "a reference-output overlay",
      "reference",
      ["samples/button/reference/css/tokens.css"],
      unreachable(["types", "properties", "rules", "benchmarks", "scoring"]),
    ],
    [
      "a root manifest overlay",
      "scope",
      ["package.json"],
      unreachable(["reference", "determinism", "properties", "mutations", "rules", "benchmarks", "scoring"]),
    ],
    [
      "a production-source overlay",
      "patterns",
      ["packages/tokens/src/jitter.ts"],
      unreachable(["scoring"]),
    ],
    [
      "an eval-source overlay",
      "scoring",
      ["packages/eval/src/report.ts"],
      [],
    ],
    [
      "an unknown overlay path",
      "encoding",
      ["Cargo.toml"],
      [],
    ],
  ] as const)("%s skips only the unreachable expensive gates", (_label, owner, paths, skipped) => {
    const result = reachableGates(owner, [...paths], REQUIRED);

    expect(result.skipped).toEqual(skipped);
  });

  it("keeps the owner gate in the run list when the overlay would not otherwise observe it", () => {
    const result = reachableGates("benchmarks", ["docs/reference/note.md"], REQUIRED);

    expect(result.run).toContain("benchmarks");
  });

  it("skips the timing gate on a docs overlay whose owner is a different gate", () => {
    const result = reachableGates("encoding", ["docs/reference/note.md"], REQUIRED);

    expect(result.skipped).toContainEqual({ gate: "benchmarks", reason: "unreachable" });
  });

  it("runs tests when the overlay changes the verification document that the sample-table test reads", () => {
    const result = reachableGates("encoding", ["docs/reference/verification.md"], REQUIRED);

    expect(result.run).toContain("tests");
  });

  it("runs types on a TypeScript test overlay because the root program typechecks tests", () => {
    const result = reachableGates("tests", ["packages/schema/test/failing.test.ts"], REQUIRED);

    expect(result.run).toContain("types");
  });
});

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const SKIP_TYPES_AT_HEAD = [
  "encoding/crlf",
  "encoding/double-encoded",
  "encoding/nul-byte",
  "reference/agent-reference-byte",
  "reference/manifest-only",
  "reference/reference-byte",
];

const SKIP_TESTS_AT_HEAD = [
  "encoding/crlf",
  "encoding/double-encoded",
  "encoding/nul-byte",
];

const SKIP_REFERENCE_AT_HEAD = [
  "encoding/crlf",
  "encoding/double-encoded",
  "encoding/nul-byte",
  "properties/missing-agent-property-execution",
  "rules/missing-agent-rule-title",
  "rules/missing-rule-title",
  "scope/agent-new-unlisted-dep",
  "scope/unlisted-dep",
  "tests/failing",
  "tests/it-skip",
];

const head = listSamples(repoRoot());
const headRuns = head.length === 0 ? [] : [[head] as const];

describe.each(headRuns)("self-test sample reachability at HEAD", (samples) => {
  it.each([
    ["types", "docs and samples overlays", SKIP_TYPES_AT_HEAD],
    ["tests", "docs-history overlays", SKIP_TESTS_AT_HEAD],
    ["reference", "overlays that are not production source, samples, or scripts", SKIP_REFERENCE_AT_HEAD],
  ] as const)("skips %s on the %s", (gate, _scope, expected) => {
    const actual = samples
      .filter((s) => sampleReachableGates(s, REQUIRED).skipped.some((row) => row.gate === gate))
      .map((s) => `${s.gate}/${s.name}`)
      .sort();

    expect(actual).toEqual([...expected]);
  });
});
