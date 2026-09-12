import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, onTestFinished } from "vitest";
import { callTool, type RunCli } from "../../mcp/src/index";
import * as evalApi from "../src/index";
import {
  buildPromptInput, loadTrajectoryMatrix, readTrajectoryRuns, TrajectoryMatrix, type TrajectoryRun,
} from "../src/index";

const root = resolve(import.meta.dirname, "../../..");
const REQUIRED_MATRIX = resolve(root, "eval/trajectory.yaml");
const SNAPSHOT = "samples/button/snapshot.json";
const AGENT_REFERENCE = readFileSync(resolve(root, "samples/button/reference/context.agent.json"), "utf8");

const runCli: RunCli = (argv) => {
  const runs = mkdtempSync(join(tmpdir(), "tl-format-rules-"));
  const result = spawnSync(process.execPath, [
    resolve(root, "node_modules/tsx/dist/cli.mjs"), resolve(root, "apps/cli/src/main.ts"), ...argv,
  ], { cwd: root, encoding: "utf8", env: { ...process.env, TOKENLOOM_RUNS_DIR: runs } });
  rmSync(runs, { recursive: true, force: true });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

/** The condition of the concluded T804 experiment: readable in an archived record, runnable nowhere. */
const CONCLUDED = "cli-agent-compact";
/** The shared test setup redirects writes to a temporary directory; committed records live in the repository. */
const AMBIENT_RUNS_DIR = process.env.TOKENLOOM_RUNS_DIR;

function committedRuns(relative: string): TrajectoryRun[] {
  onTestFinished(() => { process.env.TOKENLOOM_RUNS_DIR = AMBIENT_RUNS_DIR; });
  process.env.TOKENLOOM_RUNS_DIR = resolve(root, relative);
  return readTrajectoryRuns(root);
}

describe("Alternate Agent output format rules from docs/reference/spec.md section 4.14", () => {
  it("A11: the default CLI Agent view still emits Agent JSON", () => {
    const result = runCli([
      "context", "Button", `--from=${SNAPSHOT}`, "--view=agent", "--annotations", "--json",
    ]);

    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: AGENT_REFERENCE });
  });

  it("A11: the default MCP Agent view still returns Agent JSON", () => {
    const result = callTool(runCli, "design_context", {
      component: "Button", from: SNAPSHOT, view: "agent", annotations: true,
    });

    expect(result).toEqual({ content: [{ type: "text", text: AGENT_REFERENCE }] });
  });

  it("A11: the default evaluation Agent input still carries Agent JSON", () => {
    const input = buildPromptInput(root, "button", "agent");

    expect(`${input.context}\n`).toBe(AGENT_REFERENCE);
  });

  it("A11: the required set remains the three-condition Agent JSON experiment", () => {
    const required = loadTrajectoryMatrix(REQUIRED_MATRIX);

    expect({ conditions: required.conditions, agentView: required.prompt.views["cli-agent"] }).toEqual({
      conditions: ["cli-canonical", "cli-agent", "mcp-agent"],
      agentView: "A query returns the agent design context view of the tokenloom CLI.",
    });
  });

  it("A11: the evaluation package exports no alternate-format encoder", () => {
    const exported = Object.keys(evalApi).filter((name) => /compact/i.test(name));

    expect(exported).toEqual([]);
  });

  it("A11: a matrix cannot name the concluded compact condition or give it a view", () => {
    const required = loadTrajectoryMatrix(REQUIRED_MATRIX);

    const result = TrajectoryMatrix.safeParse({
      ...required,
      conditions: [...required.conditions, CONCLUDED],
      prompt: { ...required.prompt, views: { ...required.prompt.views, [CONCLUDED]: "compact text" } },
    });

    expect({ parsed: result.success, paths: result.error?.issues.map((issue) => issue.path.join(".")).sort() })
      .toEqual({ parsed: false, paths: ["conditions.3", "prompt.views.cli-agent-compact"] });
  });

  it("A11: every committed run record still parses, the concluded condition included", () => {
    const records = [...committedRuns("runs"), ...committedRuns("runs/archive")];

    expect({ parsed: records.length > 0, conditions: [...new Set(records.map((run) => run.condition))].sort() })
      .toEqual({ parsed: true, conditions: ["cli-agent", CONCLUDED, "cli-canonical", "mcp-agent"] });
  });
});
