import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { realRun } from "@tokenloom/eval";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");
const matrix = "eval/trajectory.yaml";
/** eval/trajectory.yaml expands to 4 tasks x 3 conditions x 2 repeats. */
const RUNS = 24;
/** Larger than a stdin pipe buffer, so the write cannot land before an unreading child exits. */
const BIG_STDIN = 1_000_000;
/** The failed write is reported after the child closes, so the assertion waits for that turn of the loop. */
const EPIPE_SETTLE_MS = 50;

interface Row { task: string; condition: string; repeat: number; adapter: string }

/** Each command writes into its own runs directory, so the records read back are exactly the ones it produced. */
function run(args: string[], env: NodeJS.ProcessEnv) {
  const runsDir = mkdtempSync(join(tmpdir(), "tl-runs-"));
  const result = spawnSync(process.execPath, [cli, "eval", "trajectory", ...args], {
    cwd: root, encoding: "utf8", env: { ...env, TOKENLOOM_RUNS_DIR: runsDir },
  });
  const records = readdirSync(runsDir).flatMap((name) => readFileSync(join(runsDir, name), "utf8")
    .split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Row));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, records };
}

const guarded = { ...process.env, TOKENLOOM_NO_SPAWN: "1" };

/**
 * The suite sets TOKENLOOM_NO_SPAWN so no test can reach `claude`. A fake-adapter set selects no provider
 * adapter at all and spawns only the repository's own `git` for the reference lock, so it drops that guard.
 */
function fakeSet(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, TOKENLOOM_LLM: "fake" };
  delete env.TOKENLOOM_NO_SPAWN;
  return run(["--matrix", matrix, ...args], env);
}

describe("the eval trajectory subcommand through the built CLI", () => {
  it("writes every fake record despite a low real-provider budget", () => {
    const result = fakeSet(["--budget-usd", "0.001", "--json"]);

    expect({
      status: result.status,
      records: result.records.length,
      combinations: new Set(result.records.map((r) => `${r.task}/${r.condition}/${r.repeat}`)).size,
      adapters: [...new Set(result.records.map((r) => r.adapter))],
    }).toEqual({ status: 0, records: RUNS, combinations: RUNS, adapters: ["fake"] });
  });

  it("puts the run count and the report on stdout as the only JSON value", () => {
    const result = fakeSet(["--json"]);

    const body = JSON.parse(result.stdout) as { runs: number; stopped: string | null; report: string };
    expect({ runs: body.runs, stopped: body.stopped, heading: body.report.split("\n")[0] })
      .toEqual({ runs: RUNS, stopped: null, heading: "# tokenloom trajectory" });
  });

  it("prints the report itself when --json is absent", () => {
    const result = fakeSet([]);

    expect(result.stdout.split("\n")[0]).toBe("# tokenloom trajectory");
  });

  it("plans the whole set under --dry-run without spawning a child process or writing a record", () => {
    const result = run(["--matrix", matrix, "--dry-run", "--json"], guarded);

    const plan = JSON.parse(result.stdout) as { runs: number };
    expect({ status: result.status, records: result.records.length, planned: plan.runs })
      .toEqual({ status: 0, records: 0, planned: RUNS });
  });

  it.each([
    { name: "a matrix path that does not exist", args: ["--matrix", "eval/absent.yaml"] },
    { name: "an unknown option", args: ["--matrix", matrix, "--bogus"] },
    { name: "--runs-dir as a public option", args: ["--matrix", matrix, "--runs-dir", "elsewhere"] },
    { name: "a missing --matrix", args: ["--json"] },
    { name: "a --budget-usd without a value", args: ["--matrix", matrix, "--budget-usd", "--json"] },
    { name: "a --budget-usd that is not a positive number", args: ["--matrix", matrix, "--budget-usd", "abc"] },
    { name: "a --budget-usd above the matrix ceiling", args: ["--matrix", matrix, "--budget-usd", "6"] },
  ])("rejects $name with the usage exit code and no stdout", ({ args }) => {
    const result = run(args, guarded);

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr.startsWith("tokenloom: ") })
      .toEqual({ status: 1, stdout: "", stderr: true });
  });

  /**
   * The reference-lock lookup pipes stdin to `git`, which exits without reading it. Without an error
   * listener on that stream the EPIPE became an unhandled event that killed the whole CLI process.
   */
  it("survives a child that exits without reading stdin and still reports its exit code", async () => {
    const uncaught: string[] = [];
    const capture = (error: Error) => uncaught.push(error.message);
    const priorNoSpawn = process.env.TOKENLOOM_NO_SPAWN;
    process.on("uncaughtException", capture);
    try {
      delete process.env.TOKENLOOM_NO_SPAWN;

      const result = await realRun(process.execPath, ["-e", "process.exit(7)"], root, "x".repeat(BIG_STDIN));

      await new Promise((resolve) => { setTimeout(resolve, EPIPE_SETTLE_MS); });
      expect({ code: result.code, uncaught }).toEqual({ code: 7, uncaught: [] });
    } finally {
      if (priorNoSpawn === undefined) delete process.env.TOKENLOOM_NO_SPAWN;
      else process.env.TOKENLOOM_NO_SPAWN = priorNoSpawn;
      process.off("uncaughtException", capture);
    }
  });

  it("names the missing matrix file in the usage message", () => {
    const result = run(["--matrix", "eval/absent.yaml"], guarded);

    expect(result.stderr).toBe("tokenloom: eval trajectory: --matrix eval/absent.yaml does not exist\n");
  });
});
