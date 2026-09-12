import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../..");

interface WorkflowStep {
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface Workflow {
  jobs?: { full?: { steps?: WorkflowStep[] } };
}

function workflowOf(text: string): Workflow {
  return parse(text) as Workflow;
}

function fullVerifyCommands(workflow: Workflow): string[] {
  return (workflow.jobs?.full?.steps ?? [])
    .flatMap((step) => step.run === undefined ? [] : [step.run.trim()])
    .filter((command) => command.startsWith("pnpm verify"));
}

const workflow = workflowOf(readFileSync(resolve(root, ".github/workflows/verify.yml"), "utf8"));

describe("full verification workflow", () => {
  it("runs the verifier's whole-repository default rather than a hand-picked gate subset", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect({
      workflowCommands: fullVerifyCommands(workflow),
      packageCommand: packageJson.scripts.verify,
    }).toEqual({
      workflowCommands: ["pnpm verify"],
      packageCommand: "tsx packages/verify/src/cli.ts",
    });
  });

  it("uploads whatever report the verifier writes, without naming a development phase", () => {
    const upload = workflow.jobs?.full?.steps?.find((step) => step.uses === "actions/upload-artifact@v4");

    expect(upload?.with).toEqual({ name: "verify-report", path: "verify/verify-*.json" });
  });

  it("catches narrowed, missing, and no-op full verification steps", () => {
    const faults = [
      { jobs: { full: { steps: [{ run: "pnpm verify --gate types" }] } } },
      { jobs: { full: { steps: [] } } },
      { jobs: { full: { steps: [{ run: "true" }] } } },
    ];
    const caught = faults.filter((candidate) =>
      fullVerifyCommands(candidate).length !== 1 || fullVerifyCommands(candidate)[0] !== "pnpm verify").length;

    expect({ attempted: faults.length, caught, survived: faults.length - caught })
      .toEqual({ attempted: 3, caught: 3, survived: 0 });
  });
});
