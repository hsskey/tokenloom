import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { Snapshot, stableJsonFile } from "@tokenloom/schema";
import type { VerifyContext } from "../src/verify-context";
import {
  MUTATION_IDS, agentOutputChecks, snapshotSamples, type MutationExpect,
} from "../src/gates/reference";

const spec = (fields: Partial<MutationExpect>): MutationExpect => ({ exit: 0, ...fields });
const repoRoot = resolve(import.meta.dirname, "../../..");
const cli = resolve(repoRoot, "apps/cli/dist/tokenloom.js");

function contextWithSampleProps(props: Record<string, string>): VerifyContext {
  const root = mkdtempSync(join(tmpdir(), "tl-selector-"));
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }); });
  const sample = join(root, "samples/edge");
  mkdirSync(join(sample, "reference"), { recursive: true });
  const snapshot = Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "EDGE", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: [{
      id: "1:1", name: "Edge", props: {},
      components: [{
        id: "1:2", props,
        root: {
          id: "1:3", name: "Edge", type: "FRAME", visible: true,
          bbox: { x: 0, y: 0, w: 1, h: 1 }, bound: {}, children: [],
        },
      }],
    }],
  });
  writeFileSync(join(sample, "snapshot.json"), stableJsonFile(snapshot));
  return { root } as VerifyContext;
}

describe("selected-variant command construction", () => {
  it.each([
    [{}, "{}"],
    [{ "tone,=": " a%\uD800 " }, "tone%2C%3D=%20a%25%uD800%20"],
    [{ "--kind": "x" }, "--kind=x"],
  ] as const)("uses the canonical selector for schema-valid props %#", (props, expected) => {
    const samples = snapshotSamples(contextWithSampleProps(props));

    expect(samples.map((sample) => sample.variant)).toEqual([expected]);
  });

  it("carries an option-like selector through the built CLI as one argument", () => {
    const context = contextWithSampleProps({ "--kind": "x" });
    const sample = snapshotSamples(context)[0];
    if (sample === undefined) throw new Error("edge sample was not discovered");
    const common = [
      cli, "context", sample.component, `--from=${join(context.root, sample.snapshot)}`,
      "--annotations", "--json", "--view=agent",
    ];
    const attached = spawnSync(process.execPath, [...common, `--variant=${sample.variant}`], {
      cwd: repoRoot, encoding: "utf8",
    });
    const separated = spawnSync(process.execPath, [...common, "--variant", sample.variant], {
      cwd: repoRoot, encoding: "utf8",
    });
    const result = JSON.parse(attached.stdout) as { component: { base: { props: Record<string, string> } } };

    expect({
      attached: { status: attached.status, props: result.component.base.props },
      separated: { status: separated.status, stdout: separated.stdout, stderr: separated.stderr },
    }).toEqual({
      attached: { status: 0, props: { "--kind": "x" } },
      separated: { status: 1, stdout: "", stderr: "tokenloom: unknown option --kind\n" },
    });
  });
});

describe("mutation gate scope", () => {
  it("requires every mutation sample the specification defines, including the Agent-view cases", () => {
    expect(MUTATION_IDS).toEqual(Array.from({ length: 15 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`));
  });
});

describe("Agent mutation output", () => {
  it("accepts M13 only when the structured error and available field are present", () => {
    const expectation = spec({ jsonError: "VARIANT_NOT_FOUND", includes: ["available"] });
    const valid = JSON.stringify({ error: { code: "VARIANT_NOT_FOUND", available: ["size=md"] }, next: [] });
    const silent = "";

    expect(agentOutputChecks(expectation, valid)).toEqual([]);
    expect(agentOutputChecks(expectation, silent)).toEqual(["Agent output is not JSON"]);
  });

  it("accepts M14 only when both discovery counts are zero", () => {
    const expectation = spec({ count: 0, returned: 0 });

    expect(agentOutputChecks(expectation, '{"components":[],"count":0,"returned":0,"truncated":false}')).toEqual([]);
    expect(agentOutputChecks(expectation, '{"components":[],"count":1,"returned":0,"truncated":true}'))
      .toEqual(["count 1 != 0"]);
  });

  it("compares M15 annotations, warnings, and every node id with canonical output", () => {
    const expectation = spec({ preserves: ["annotations", "warnings", "nodeId"] });
    const canonical = JSON.stringify({
      annotations: [{ nodeId: "1:2", text: "note" }], warnings: [{ code: "UNBOUND_COLOR", nodeId: "1:2" }],
      component: { base: { root: { id: "1:2", children: [{ id: "1:3" }] } } },
    });
    const same = JSON.stringify({
      annotations: [{ nodeId: "1:2", text: "note" }], warnings: [{ code: "UNBOUND_COLOR", nodeId: "1:2" }],
      component: { base: { root: { id: "1:2", children: [{ id: "1:3" }] } } },
    });
    const missingId = JSON.stringify({
      annotations: [{ nodeId: "1:2", text: "note" }], warnings: [{ code: "UNBOUND_COLOR", nodeId: "1:2" }],
      component: { base: { root: { id: "1:2", children: [] } } },
    });

    expect(agentOutputChecks(expectation, same, canonical)).toEqual([]);
    expect(agentOutputChecks(expectation, missingId, canonical)).toEqual(["nodeId was not preserved"]);
  });
});
