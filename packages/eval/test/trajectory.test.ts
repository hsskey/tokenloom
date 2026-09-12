import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { estimateTokens } from "@tokenloom/schema";
import {
  costUpperBound, createSessionPort, effectiveOutputTokenCap, fakeAdapter, loadTrajectoryMatrix,
  readTrajectoryRuns, runTrajectory, trajectoryCombinations, planTrajectory, summarizeTrajectory, totalInput, trajectoryTotalCost,
  type ChildOutput, type ChildRunWithStdin, type LlmAdapter, type LlmResult, type Rate, type ToolPort,
  type TrajectoryMatrixT, type TrajectoryOptions, type TrajectoryRun,
} from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const MATRIX = resolve(repoRoot, "eval/trajectory.yaml");
const matrix = (): TrajectoryMatrixT => loadTrajectoryMatrix(MATRIX);
const LOCK = "0123456789abcdef0123456789abcdef01234567";
const INSTRUCTION_TOKEN_BUDGET = 2000;
const RATE: Rate = {
  resolvedModel: "opus", inputPerMTok: 5, cacheWrite1hPerMTok: 10, cacheReadPerMTok: 0.5, outputPerMTok: 25,
};

/** Stubs the locked commit and its manifest, so records stay byte-identical between runs. */
const gitLock: ChildRunWithStdin = (_command, args, cwd) => Promise.resolve<ChildOutput>({
  code: 0, stdout: args[0] === "show" ? readFileSync(join(cwd, "samples/manifest.json"), "utf8") : `${LOCK}\n`, stderr: "",
});

const usage = { inputTokens: 0, cacheCreation: 0, cacheRead: 0, outputTokens: 0 };
function reply(text: string, costUsd: number | null = 0): LlmResult {
  return { ...usage, text, model: "fake", ms: 0, invocation: "fake", costUsd };
}

/** Returns the scripted turns in order and repeats the last one, so a loop cannot read past the script. */
function scripted(texts: string[], costUsd: number | null = 0, kind: LlmAdapter["kind"] = "fake"): LlmAdapter {
  let turn = 0;
  return {
    kind,
    run: () => {
      const text = texts[Math.min(turn, texts.length - 1)] ?? "";
      turn += 1;
      return Promise.resolve(reply(text, costUsd));
    },
  };
}

function stubPort(responses: { content: string; exitCode: number }[]): { port: ToolPort; calls: string[][] } {
  const calls: string[][] = [];
  const port: ToolPort = {
    kind: "cli",
    call: (request) => {
      const answer = responses[Math.min(calls.length, responses.length - 1)] ?? { content: "{}", exitCode: 0 };
      calls.push(request.args);
      return Promise.resolve({ ...answer, stderr: "" });
    },
  };
  return { port, calls };
}

/** Each case writes to its own runs directory, which also proves TOKENLOOM_RUNS_DIR is honoured. */
function options(over: Partial<TrajectoryOptions> = {}): TrajectoryOptions {
  const dir = mkdtempSync(join(tmpdir(), "tl-traj-"));
  const saved = process.env.TOKENLOOM_RUNS_DIR;
  process.env.TOKENLOOM_RUNS_DIR = dir;
  onTestFinished(() => { process.env.TOKENLOOM_RUNS_DIR = saved; });
  return {
    repoRoot, matrix: matrix(), utcDate: "2026-09-07", rate: null, child: gitLock,
    makeAdapter: () => fakeAdapter,
    toolPortFor: () => stubPort([{ content: "{}", exitCode: 0 }]).port,
    ...over,
  };
}

const FINAL = "```css\n.b { color: var(--color-button-primary-bg); }\n```\n```html\n<b></b>\n```";

function oneTask(source: TrajectoryMatrixT): TrajectoryMatrixT {
  const first = source.tasks[0];
  if (first === undefined) throw new Error("matrix must define a task");
  return { ...source, tasks: [first], conditions: ["cli-agent"], repeats: 1 };
}

function referenceRoot(tokensCss: string, cssHash?: string, snapshotHash?: string): string {
  const root = mkdtempSync(join(tmpdir(), "tl-reference-"));
  const [cssPath, snapshotPath, snapshot] = [
    "samples/button/reference/css/tokens.css", "samples/button/snapshot.json", "{}",
  ];
  const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
  mkdirSync(join(root, "samples/button/reference/css"), { recursive: true });
  writeFileSync(join(root, cssPath), tokensCss);
  writeFileSync(join(root, snapshotPath), snapshot);
  writeFileSync(join(root, "samples/manifest.json"), JSON.stringify({
    [cssPath]: `sha256:${cssHash ?? digest(tokensCss)}`,
    [snapshotPath]: `sha256:${snapshotHash ?? digest(snapshot)}`,
  }));
  return root;
}

describe("trajectory matrix", () => {
  it("expands the required 4 tasks x 3 conditions x 2 repeats set", () => {
    const m = matrix();

    expect(m.tasks.map((t) => t.task))
      .toEqual(["known-component", "unknown-component", "variant-only", "recovery"]);
    expect(m.conditions).toEqual(["cli-canonical", "cli-agent", "mcp-agent"]);
    expect(trajectoryCombinations(m)).toHaveLength(24);
  });

  it("keeps every fixed instruction inside the 2000 estimated-token turn budget", () => {
    const m = matrix();
    const sizes = m.conditions.flatMap((condition) => m.tasks.map((spec) =>
      estimateTokens(Buffer.byteLength(createSessionPort(condition, m.tasks, m.prompt).openingPrompt(spec.task), "utf8"))));

    expect(Math.max(...sizes)).toBeLessThanOrEqual(INSTRUCTION_TOKEN_BUDGET);
  });

  it("plans the whole set without calling a model", () => {
    expect(planTrajectory(matrix()).runs).toBe(24);
  });
});

describe("reference lock", () => {
  it("accepts scoring and snapshot inputs that match their manifest entries", async () => {
    const root = referenceRoot(":root { --color-button-primary-bg: #fff; }");
    const set = await runTrajectory(options({
      repoRoot: root, matrix: oneTask(matrix()), makeAdapter: () => scripted([FINAL]),
    }));

    expect(set.records[0]).toMatchObject({ s1: 1, s2: 1, artifact: { sampleName: "button" } });
  });

  it("rejects mismatched scoring input before model selection", async () => {
    const root = referenceRoot(":root { --color-button-primary-bg: #fff; }", "0".repeat(64));
    const opts = options({
      repoRoot: root, matrix: oneTask(matrix()),
      makeAdapter: () => { throw new Error("model selected"); },
    });

    await expect(runTrajectory(opts)).rejects.toThrow(
      "reference input mismatch: samples/button/reference/css/tokens.css",
    );
  });

  it("rejects mismatched snapshot input before model selection", async () => {
    const root = referenceRoot(":root { --color-button-primary-bg: #fff; }", undefined, "0".repeat(64));
    const opts = options({
      repoRoot: root, matrix: oneTask(matrix()),
      makeAdapter: () => { throw new Error("model selected"); },
    });

    await expect(runTrajectory(opts)).rejects.toThrow(
      "reference input mismatch: samples/button/snapshot.json",
    );
  });

  it("rejects current inputs that only match a newer working-tree manifest", async () => {
    const root = referenceRoot(":root { --color-button-primary-bg: #fff; }");
    const child: ChildRunWithStdin = (_command, args) => Promise.resolve({
      code: 0, stdout: args[0] === "show" ? JSON.stringify({
        "samples/button/reference/css/tokens.css": `sha256:${"0".repeat(64)}`,
      }) : `${LOCK}\n`, stderr: "",
    });

    await expect(runTrajectory(options({ repoRoot: root, matrix: oneTask(matrix()), child })))
      .rejects.toThrow("reference input mismatch: samples/button/reference/css/tokens.css");
  });

  it.each([
    { name: "the git lookup fails", output: { code: 1, stdout: "", stderr: "failed" } },
    { name: "git returns a non-SHA value", output: { code: 0, stdout: "not-a-sha\n", stderr: "" } },
  ])("rejects before model selection when $name", async ({ output }) => {
    const opts = options({
      child: () => Promise.resolve(output),
      makeAdapter: () => { throw new Error("model selected"); },
    });

    await expect(runTrajectory(opts)).rejects.toThrow("reference-lock lookup failed");
  });
});

describe("fake trajectory set", () => {
  it("produces 24 records and the same bytes on a second run", async () => {
    const first = await runTrajectory(options());
    const second = await runTrajectory(options());

    expect(first.records).toHaveLength(24);
    const strip = (runs: TrajectoryRun[]): unknown => runs.map(({ durationMs: _ms, ...rest }) => rest);
    expect(strip(second.records)).toEqual(strip(first.records));
  });

  it("writes one JSONL row per run into the runs directory named by TOKENLOOM_RUNS_DIR", async () => {
    const opts = options();

    const set = await runTrajectory(opts);

    expect(set.path).toBe(join(process.env.TOKENLOOM_RUNS_DIR ?? "", "2026-09-07.jsonl"));
    expect(readFileSync(set.path ?? "", "utf8").trim().split("\n")).toHaveLength(24);
    expect(readTrajectoryRuns(repoRoot)).toHaveLength(24);
  });

  it("rejects a trajectory row with a nonnumeric token count", async () => {
    const set = await runTrajectory(options());
    const malformed = { ...set.records[0], inputTokens: "100" };
    writeFileSync(set.path ?? "", `${JSON.stringify(malformed)}\n`);

    expect(() => readTrajectoryRuns(repoRoot)).toThrow();
  });

  it("records the fixed fields the design note pins for every row", async () => {
    const set = await runTrajectory(options());
    const record = set.records[0];

    expect(record?.cmd).toBe("trajectory");
    expect(record?.adapter).toBe("fake");
    expect(record?.success).toBe(true);
    expect(record?.turns).toBe(1);
    expect(record?.s1).toBe(1);
    expect(record?.artifact?.sampleName).toBe("button");
    expect(record?.artifact?.referenceLockCommit).toBe(LOCK);
    expect(record?.artifact?.tokensCssSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.promptHash).toHaveLength(12);
  });
});

describe("tool loop", () => {
  it("runs the requested query and feeds its output into the next turn", async () => {
    const { port, calls } = stubPort([{ content: "{\"component\":{}}", exitCode: 0 }]);
    const adapter = scripted(["TOOL component=Button", FINAL], 0.01, "claude");
    const set = await runTrajectory(options({
      matrix: oneTask(matrix()), rate: RATE, makeAdapter: () => adapter, toolPortFor: () => port,
    }));
    const record = set.records[0];

    expect(calls).toEqual([["component=Button", "from=samples/button/snapshot.json", "view=agent"]]);
    expect(record?.turns).toBe(2);
    expect(record?.toolCalls).toEqual([
      { turn: 0, tool: "context", args: calls[0], exitCode: 0, bytes: 16 },
    ]);
    expect(record?.success).toBe(true);
  });

  it("keeps the harness view even when the model asks for another one", async () => {
    const { port, calls } = stubPort([{ content: "{}", exitCode: 0 }]);
    const adapter = scripted(["TOOL component=Button view=agent from=/etc/passwd", FINAL]);
    await runTrajectory(options({
      matrix: { ...oneTask(matrix()), conditions: ["cli-canonical"] },
      makeAdapter: () => adapter, toolPortFor: () => port,
    }));

    expect(calls[0]).toEqual(["component=Button", "from=samples/button/snapshot.json", "view=canonical"]);
  });

  it("records a resolved recovery when a structured Agent error is followed by a successful query", async () => {
    const failure = JSON.stringify({ error: { code: "COMPONENT_NOT_FOUND", detail: "no Buttons" }, next: [] });
    const { port } = stubPort([{ content: failure, exitCode: 1 }, { content: "{}", exitCode: 0 }]);
    const adapter = scripted(["TOOL component=Buttons", "TOOL component=Button", FINAL]);
    const set = await runTrajectory(options({
      matrix: oneTask(matrix()), makeAdapter: () => adapter, toolPortFor: () => port,
    }));

    expect(set.records[0]?.recovery).toEqual([{ turn: 0, code: "COMPONENT_NOT_FOUND", resolved: true }]);
    expect(set.records[0]?.success).toBe(true);
  });

  it("rejects a real completion that never queried tokenloom", async () => {
    const set = await runTrajectory(options({
      matrix: oneTask(matrix()), rate: RATE,
      makeAdapter: () => scripted([FINAL], 0.01, "claude"),
    }));

    expect(set.records[0]).toMatchObject({
      success: false, error: "NO_SUCCESSFUL_TOOL_CALL", turns: 1, toolCalls: [], costUsd: 0.01,
    });
  });

  it("rejects a real completion that leaves a recovery unresolved", async () => {
    const failure = JSON.stringify({ error: { code: "COMPONENT_NOT_FOUND", detail: "no Buttons" }, next: [] });
    const { port } = stubPort([{ content: failure, exitCode: 1 }]);
    const adapter = scripted(["TOOL component=Buttons", FINAL], 0.01, "claude");
    const set = await runTrajectory(options({
      matrix: oneTask(matrix()), rate: RATE, makeAdapter: () => adapter, toolPortFor: () => port,
    }));

    expect(set.records[0]).toMatchObject({
      success: false, error: "UNRESOLVED_RECOVERY", turns: 2, costUsd: 0.02, s1: 1, s2: 1,
      artifact: { output: FINAL, sampleName: "button", referenceLockCommit: LOCK },
      recovery: [{ turn: 0, code: "COMPONENT_NOT_FOUND", resolved: false }],
    });
  });

  it("stops a run at the turn cap and keeps the turns and cost actually paid", async () => {
    const { port } = stubPort([{ content: "{}", exitCode: 0 }]);
    const set = await runTrajectory(options({
      matrix: { ...oneTask(matrix()), maxTurns: 3 },
      makeAdapter: () => scripted(["TOOL component=Button"]),
      toolPortFor: () => port,
    }));

    expect(set.records[0]).toMatchObject({
      error: "MAX_TURNS", turns: 3, success: false, artifact: null, s1: null, s2: null,
    });
  });
});

describe("budget enforcement", () => {
  it("rejects a Claude adapter without pricing before its first call", async () => {
    const unpriced: LlmAdapter = {
      kind: "claude",
      run: () => { throw new Error("model called"); },
    };

    await expect(runTrajectory(options({ rate: null, makeAdapter: () => unpriced })))
      .rejects.toThrow("missing pricing for claude adapter");
  });

  it("bounds a call by prompt tokens, both measured per-call blocks, and the capped output", () => {
    const m = matrix();
    const bytes = 2800;
    const expected = ((estimateTokens(bytes) + m.sessionWriteTokens) * RATE.cacheWrite1hPerMTok
      + m.sessionPrefixTokens * RATE.cacheReadPerMTok + m.maxOutputTokens * RATE.outputPerMTok) / 1_000_000;

    expect(costUpperBound(bytes, m, RATE)).toBeCloseTo(expected, 10);
    expect(costUpperBound(bytes, m, RATE)).toBeGreaterThan(m.sessionPrefixTokens * RATE.cacheReadPerMTok / 1_000_000);
  });

  it("derives the configured output cap from the same bounded input and dollar ceiling", () => {
    const m = matrix();
    const bytes = 2800;
    const ceiling = costUpperBound(bytes, m, RATE);

    expect(effectiveOutputTokenCap(ceiling, bytes, m, RATE)).toBeCloseTo(m.maxOutputTokens, 10);
  });

  it("contains cheaper-than-estimated input by the provider dollar ceiling", () => {
    const m = matrix();
    const ceiling = costUpperBound(2800, m, RATE);
    const zeroInputWorstCase = ceiling * 1_000_000 / RATE.outputPerMTok;
    const boundedInputAtOutputRate = ((estimateTokens(2800) + m.sessionWriteTokens) * RATE.cacheWrite1hPerMTok
      + m.sessionPrefixTokens * RATE.cacheReadPerMTok) / RATE.outputPerMTok;

    expect(zeroInputWorstCase).toBeCloseTo(m.maxOutputTokens + boundedInputAtOutputRate, 10);
    expect(zeroInputWorstCase).toBeGreaterThan(m.maxOutputTokens);
  });

  it("ends the set as budget-stopped and records the cost already paid", async () => {
    const m = matrix();
    // A per-call cost below the bound cannot be a pricing defect, so the set can only stop on budget.
    const bound = costUpperBound(0, m, RATE);
    const cost = bound / 2;
    const budgetUsd = bound * 3;
    const set = await runTrajectory(options({
      matrix: { ...m, budgetUsd },
      rate: RATE,
      makeAdapter: () => scripted([FINAL], cost, "claude"),
    }));

    expect(set.stopped).toBe("budget");
    expect(set.records.at(-1)).toMatchObject({ error: "BUDGET_STOP", turns: 0, costUsd: 0 });
    expect(set.costUsd).toBeCloseTo(cost * (set.records.length - 1), 10);
    expect(trajectoryTotalCost(set.records)).toBeCloseTo(set.costUsd, 10);
    expect(set.records.length).toBeLessThan(24);
  });

  it("stops the set when the provider reports more than the pre-call bound", async () => {
    const m = matrix();
    const set = await runTrajectory(options({
      matrix: oneTask(m),
      rate: RATE,
      makeAdapter: () => scripted([FINAL], m.budgetUsd, "claude"),
    }));

    expect(set.stopped).toBe("pricing");
    expect(set.records[0]?.error).toBe("PRICING_DEFECT");
  });

  it("preserves incomplete usage when a pricing defect stops the set", async () => {
    const m = matrix();
    const incomplete: LlmAdapter = {
      kind: "claude",
      run: () => Promise.resolve({ ...reply(FINAL, m.budgetUsd), error: "MISSING_AUTHORITATIVE_USAGE" }),
    };
    const set = await runTrajectory(options({
      matrix: oneTask(m), rate: RATE, makeAdapter: () => incomplete,
    }));
    const record = set.records[0] as TrajectoryRun;
    const summary = summarizeTrajectory(set.records, {
      promptHash: record.promptHash, model: record.model, invocation: record.invocation,
    })[0];

    expect(record).toMatchObject({ error: "PRICING_DEFECT", incomparable: true });
    expect(summary).toMatchObject({ runs: 0, incomparableRuns: 1, inputTokensP50: null, s1P50: null });
  });

  it("stops the set when a successful Claude response omits authoritative cost", async () => {
    const set = await runTrajectory(options({
      matrix: oneTask(matrix()),
      rate: RATE,
      makeAdapter: () => scripted([FINAL], null, "claude"),
    }));

    expect(set.stopped).toBe("pricing");
    expect(set.records[0]?.success).toBe(false);
    expect(set.records[0]?.error).toBe("MISSING_AUTHORITATIVE_COST");
    expect(set.records[0]?.costUsd).toBeNull();
    expect(set.costUsd).toBe(0);
  });

  it("stops the set when an errored Claude response omits authoritative cost", async () => {
    const failed: LlmAdapter = {
      kind: "claude",
      run: () => Promise.resolve({ ...reply("", null), error: "PROVIDER_ERROR" }),
    };
    const set = await runTrajectory(options({
      matrix: oneTask(matrix()), rate: RATE, makeAdapter: () => failed,
    }));

    expect(set.stopped).toBe("pricing");
    expect(set.records[0]?.error).toBe("MISSING_AUTHORITATIVE_COST: PROVIDER_ERROR");
    expect(set.records[0]?.costUsd).toBeNull();
  });

  it("reserves the measured cache-written instruction block the provider bills outside the prompt", () => {
    const m = matrix();
    const without = { ...m, sessionWriteTokens: 0 };

    expect(costUpperBound(2800, m, RATE) - costUpperBound(2800, without, RATE))
      .toBeCloseTo(m.sessionWriteTokens * RATE.cacheWrite1hPerMTok / 1_000_000, 10);
  });
});

describe("aggregation input", () => {
  it("sums the three provider input categories of a run", () => {
    const run = { inputTokens: 1, cacheCreation: 2, cacheRead: 4 } as TrajectoryRun;

    expect(totalInput(run)).toBe(7);
  });
});
