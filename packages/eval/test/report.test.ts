import { describe, expect, it } from "vitest";
import {
  S1_INPUT_CAUSE, S1_INPUT_NOTE, S1_INPUT_RETRY,
  buildFailures, buildMcpCaptures, buildRows, buildSampleNotes, promptHashes, realRuns,
} from "../src/stats";
import type { ReportModel, Row } from "../src/stats";
import { WORKS_NOTE, renderReport, renderReports } from "../src/report";
import type { EvalRun } from "../src/runs";

/** Shape of a real MCP row from runs/2026-09-05.jsonl with irrelevant fields overridden. */
const LINE: EvalRun = {
  cmd: "eval", target: "real-design-system/4185:3778/mcp", utcDate: "2026-09-05", sampleName: "real-design-system",
  inputVariant: "-", input: "mcp", repeat: 0, adapter: "claude", model: "opus",
  invocation: "claude -p --output-format json --restricted --model <id>",
  promptHash: "c9525a86e192", bytesIn: 42110, bytesOut: 6222, ratio: 6.77, estTokens: 15039,
  inputTokens: 2, cacheCreation: 34170, cacheRead: 10844, outputTokens: 4168, costUsd: 0.478796,
  ms: { llm: 44883 }, warnings: 0, s1: 0, s2: 1, s3: null,
};

const MCP_TARGETS = [
  "real-design-system/4185:3778/mcp", "real-design-system/11:11508/mcp", "real-design-system/2072:9432/mcp",
  "real-design-system/185:852/mcp", "real-annotated-theme/1:13/mcp",
];

function run(over: Partial<EvalRun>): EvalRun {
  return { ...LINE, ...over };
}

/** Ten run rows: five real-file sets with two repeats, matching the full matrix MCP segment. */
function fullMcpRuns(): EvalRun[] {
  return [0, 1].flatMap((repeat) => MCP_TARGETS.map((target) => run({ target, repeat })));
}

/** Snapshot row that must not enter the MCP count in the header. */
function snapshotRun(target: string): EvalRun {
  return run({ target, input: "snapshot", inputVariant: "compact" });
}

function reportModel(over: Partial<ReportModel>): ReportModel {
  return {
    date: "2026-09-05",
    model: "opus",
    promptHash: "c9525a86e192",
    mcpCaptures: "0/0",
    rows: [], failures: [], fixedCosts: [], sampleNotes: [],
    ...over,
  };
}

function header(runs: EvalRun[]): string {
  const body = renderReport(reportModel({ mcpCaptures: buildMcpCaptures(runs) }));
  return body.split("\n")[0] ?? "";
}

describe("report-header MCP captures (SPEC 9.6)", () => {
  it("reports 10/5 for five real-file sets sent twice", () => {
    const runs = realRuns([...fullMcpRuns(), snapshotRun("button/compact")]);

    expect(header(runs)).toBe(
      "# tokenloom eval 2026-09-05 / model opus / prompt c9525a86e192 / mcp captures 10/5",
    );
  });

  it("reports 0/0 when no MCP rows exist", () => {
    const runs = realRuns([snapshotRun("button/compact"), snapshotRun("card/compact")]);

    expect(header(runs)).toBe(
      "# tokenloom eval 2026-09-05 / model opus / prompt c9525a86e192 / mcp captures 0/0",
    );
  });

  // realRuns retains a skipped row until the same target has a sent row for the failures table.
  // A skipped row invoked no adapter and used no capture, so the header excludes it.
  it("excludes skipped MCP rows", () => {
    const runs = realRuns([
      ...fullMcpRuns(),
      run({ target: "real-annotated-theme/9:9/mcp", skipped: "MAX_INPUT_TOKENS" }),
    ]);

    expect(runs.some((r) => r.skipped !== undefined)).toBe(true);
    expect(buildMcpCaptures(runs)).toBe("10/5");
  });

  it("counts after prompt-hash filtering so rows from another hash stay excluded", () => {
    const other = MCP_TARGETS.map((target) => run({
      target, promptHash: "57dcdf29f1ed", invocation: "claude -p --older-invocation",
    }));

    const runs = realRuns([...other, ...fullMcpRuns()], undefined, "c9525a86e192");

    expect(buildMcpCaptures(runs)).toBe("10/5");
    expect(buildMcpCaptures(realRuns([...other, ...fullMcpRuns()], undefined, "57dcdf29f1ed"))).toBe("5/5");
  });

  it("includes MCP capture counts and repeats in sample notes", () => {
    const notes = buildSampleNotes(realRuns(fullMcpRuns()));

    expect(notes).toContain("mcp captures runs/sets: 10/5");
    expect(notes).toContain("mcp repeats: 2");
  });
});

/** Snapshot row classified by sample name and input variant. */
function snapshotLine(over: Partial<EvalRun>): EvalRun {
  return run({ input: "snapshot", inputVariant: "compact", s1: 1, s2: 1, ...over });
}

function rowOf(rows: Row[], klass: string, input: string, inputVariant: string): Row | undefined {
  return rows.find((r) => r.class === klass && r.input === input && r.inputVariant === inputVariant);
}

describe("sections by promptHash (SPEC 9.6)", () => {
  it("returns distinct hashes in first-seen order", () => {
    const lines = [
      run({ promptHash: "c9525a86e192" }),
      run({ promptHash: "57dcdf29f1ed" }),
      run({ promptHash: "c9525a86e192" }),
    ];

    expect(promptHashes(lines)).toEqual(["c9525a86e192", "57dcdf29f1ed"]);
  });

  it("excludes fake-row hashes because reports aggregate only real calls", () => {
    const lines = [run({ promptHash: "c9525a86e192" }), run({ adapter: "fake", promptHash: "fake0000" })];

    expect(promptHashes(lines)).toEqual(["c9525a86e192"]);
  });

  it("gives each section its own model, prompt, and MCP-capture header", () => {
    const models = [
      reportModel({ promptHash: "57dcdf29f1ed", mcpCaptures: "0/0" }),
      reportModel({ promptHash: "c9525a86e192", mcpCaptures: "10/5" }),
    ];

    const headers = renderReports(models).split("\n").filter((l) => l.startsWith("# "));

    expect(headers).toEqual([
      "# tokenloom eval 2026-09-05 / model opus / prompt 57dcdf29f1ed / mcp captures 0/0",
      "# tokenloom eval 2026-09-05 / model opus / prompt c9525a86e192 / mcp captures 10/5",
    ]);
  });

  it("matches one renderReport byte-for-byte when only one section exists", () => {
    const model = reportModel({ promptHash: "c9525a86e192", mcpCaptures: "10/5" });

    expect(renderReports([model])).toBe(renderReport(model));
  });
});

describe("real-file separation and cost columns in passing rows (SPEC 9.6)", () => {
  it("separates sample designs and synthetic test data with the same variant", () => {
    const rows = buildRows([
      snapshotLine({ sampleName: "real-design-system", target: "real-design-system/4185:3778/compact", s2: 0.8 }),
      snapshotLine({ sampleName: "button", target: "button/compact", s2: 1 }),
    ]);

    expect(rowOf(rows, "Sample designs", "snapshot", "compact")?.s2).toBe("0.80");
    expect(rowOf(rows, "Synthetic test data", "snapshot", "compact")?.s2).toBe("1.00");
  });

  it("places MCP rows under sample designs because synthetic test data has no captures", () => {
    const rows = buildRows([run({}), snapshotLine({ sampleName: "button", target: "button/compact" })]);

    expect(rows.filter((r) => r.input === "mcp").map((r) => r.class)).toEqual(["Sample designs"]);
  });

  it("uses sent-row costUsd p50 for each cost column", () => {
    const rows = buildRows([
      snapshotLine({ sampleName: "button", target: "button/compact", repeat: 0, costUsd: 0.02 }),
      snapshotLine({ sampleName: "button", target: "button/compact", repeat: 1, costUsd: 0.3 }),
      snapshotLine({ sampleName: "single-mode", target: "single-mode/compact", costUsd: 0.04 }),
    ]);

    expect(rowOf(rows, "Synthetic test data", "snapshot", "compact")?.costP50).toBe("0.0400");
  });

  it("reports n/a instead of inventing cost when all costUsd values are null", () => {
    const rows = buildRows([snapshotLine({ sampleName: "button", target: "button/compact", costUsd: null })]);

    expect(rowOf(rows, "Synthetic test data", "snapshot", "compact")?.costP50).toBe("n/a");
  });

  // Classification comes only from the canonical run-line sample name (SPEC 9.6).
  // Only `real-` is the real-file prefix; names that merely begin with `real` are synthetic.
  it("classifies names without the real- prefix as synthetic", () => {
    const rows = buildRows([snapshotLine({ sampleName: "realistic-card", target: "realistic-card/compact" })]);

    expect(rows.map((r) => r.class)).toEqual(["Synthetic test data"]);
  });
});

describe("S1 cause text (SPEC 9.6)", () => {
  const thresholds = { s1: 0.9, s2: 0.95, s3: 0.05 };

  it("describes raw-row S1 failure as an input property and cites the diagnosis", () => {
    const failures = buildFailures([snapshotLine({ target: "button/raw", inputVariant: "raw", s1: 0 })], thresholds);

    expect(failures[0]?.mode).toBe(`S1 0 ${S1_INPUT_CAUSE} (r0)`);
    expect(failures[0]?.retryWhen).toBe(S1_INPUT_RETRY);
  });

  it("uses the same input-property cause for MCP rows without tokensUsed", () => {
    const failures = buildFailures([run({ s1: 0 })], thresholds);

    expect(failures[0]?.mode).toBe(`S1 0 ${S1_INPUT_CAUSE} (r0)`);
  });

  it("uses the below-threshold cause for compact design context", () => {
    const failures = buildFailures([snapshotLine({ target: "real-design-system/x/compact", s1: 0 })], thresholds);

    expect(failures[0]?.mode).toBe(
      "S1 0.00 below threshold 0.90 (a var(--x) is absent from tokens.css) (r0)",
    );
  });
});

describe("rescored rows and null S1 (SPEC 9.5, 9.6)", () => {
  const thresholds = { s1: 0.9, s2: 0.95, s3: 0.05 };
  const compact = (over: Partial<EvalRun>): EvalRun =>
    snapshotLine({ sampleName: "real-design-system", target: "real-design-system/4185:3778/compact", inputVariant: "compact", ...over });
  const mark = { at: "2026-09-06", reason: "S1 against samples/real-design-system/reference/css/tokens.css" };

  it("replaces an earlier target-repeat-hash-invocation row with its marked rescore", () => {
    const kept = realRuns([compact({ s1: 0 }), compact({ s1: 1, rescored: mark })]);

    expect(kept.map((r) => r.s1)).toEqual([1]);
  });

  it("keeps two unmarked sent rows as distinct runs of the same combination", () => {
    const kept = realRuns([compact({ costUsd: 0.11 }), compact({ costUsd: 0.22 })]);

    expect(kept.map((r) => r.costUsd)).toEqual([0.11, 0.22]);
  });

  it("reports n/a when every S1 value in a group is null", () => {
    const rows = buildRows([compact({ s1: null }), compact({ s1: null, repeat: 1 })]);

    expect(rowOf(rows, "Sample designs", "snapshot", "compact")?.s1).toBe("n/a");
  });

  it("does not create a below-threshold failure for an unmeasurable null S1", () => {
    expect(buildFailures([compact({ s1: null })], thresholds)).toEqual([]);
  });

  it("averages only numeric values in a group that also contains null", () => {
    const rows = buildRows([compact({ s1: null }), compact({ s1: 1, repeat: 1 }), compact({ s1: 0, repeat: 2 })]);

    expect(rowOf(rows, "Sample designs", "snapshot", "compact")?.s1).toBe("0.50");
  });
});

describe("S1 sample-note line (SPEC 9.6)", () => {
  it("explains that S1 is an input property when raw or MCP rows exist", () => {
    expect(buildSampleNotes(realRuns(fullMcpRuns()))).toContain(S1_INPUT_NOTE);
  });

  it("omits the input-property note for compact-only rows", () => {
    const notes = buildSampleNotes([snapshotLine({ sampleName: "button", target: "button/compact" })]);

    expect(notes).not.toContain(S1_INPUT_NOTE);
  });
});

describe("input-token p50 counts cache writes only (SPEC 9.6)", () => {
  // Only the first cache write represents the cost of initially supplying the component.
  // A repeated row sends the same prompt as a cache read, leaving inputTokens + cacheCreation at 2.
  function line(over: Partial<EvalRun>): EvalRun {
    return snapshotLine({ sampleName: "button", target: "button/compact", ...over });
  }

  it("reports inputTokens plus cacheCreation p50 from cache-write rows", () => {
    const rows = buildRows([
      line({ repeat: 0, inputTokens: 2, cacheCreation: 5000 }),
      line({ repeat: 1, inputTokens: 2, cacheCreation: 7000 }),
      line({ repeat: 2, inputTokens: 2, cacheCreation: 0 }),
      line({ repeat: 3, inputTokens: 2, cacheCreation: 0 }),
    ]);

    expect(rowOf(rows, "Synthetic test data", "snapshot", "compact")?.inputTokensP50).toBe("5002");
  });

  it("reports n/a without cache writes instead of treating prefix size as input cost", () => {
    const rows = buildRows([
      line({ repeat: 0, inputTokens: 2, cacheCreation: 0 }),
      line({ repeat: 1, inputTokens: 2, cacheCreation: 0 }),
    ]);

    expect(rowOf(rows, "Synthetic test data", "snapshot", "compact")?.inputTokensP50).toBe("n/a");
  });

  it("labels the measured rows and emits the explanatory note once per section", () => {
    const body = renderReport(reportModel({ rows: [] }));

    expect(body).toContain("| Input tokens p50 (cache-write rows) |");
    expect(body.split(WORKS_NOTE)).toHaveLength(2);
  });
});

describe("failure table folds by target (SPEC 9.6)", () => {
  const thresholds = { s1: 0.9, s2: 0.95, s3: 0.05 };

  it("folds repeated target rows into one row with both values and repeat numbers", () => {
    const failures = buildFailures([
      snapshotLine({ target: "real-design-system/x/compact", repeat: 0, s1: 0 }),
      snapshotLine({ target: "real-design-system/x/compact", repeat: 1, s1: 0.5 }),
    ], thresholds);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.mode).toBe(
      "S1 0.00, 0.50 below threshold 0.90 (a var(--x) is absent from tokens.css) (r0, r1)",
    );
    expect(failures[0]?.retryWhen).toBe("design context names every token sub-property the CSS needs");
  });

  it("joins S1 and S2 failures for one target with a semicolon", () => {
    const failures = buildFailures(
      [snapshotLine({ target: "real-design-system/x/compact", repeat: 0, s1: 0, s2: 0.71 })], thresholds);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.mode).toBe(
      "S1 0.00 below threshold 0.90 (a var(--x) is absent from tokens.css) (r0);"
      + " S2 0.71 below threshold 0.95 (r0)",
    );
  });

  it("points raw and MCP rows to one cause explanation in the sample section", () => {
    const runs = realRuns(fullMcpRuns());
    const body = renderReport(reportModel({
      failures: buildFailures(runs, thresholds), sampleNotes: buildSampleNotes(runs),
    }));

    expect(body.split(S1_INPUT_NOTE)).toHaveLength(2);
    expect(body).toContain(`S1 0, 0 ${S1_INPUT_CAUSE} (r0, r1)`);
  });

  it("emits skipped rows with estimated tokens and a retry condition", () => {
    const failures = buildFailures(
      [run({ target: "real-annotated-theme/9:9/mcp", skipped: "MAX_INPUT_TOKENS", estTokens: 240000 })], thresholds);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.mode).toBe("MAX_INPUT_TOKENS est 240000 tokens (r0)");
    expect(failures[0]?.retryWhen).toBe("maxInputTokens raised or design context shrinks");
  });
});
