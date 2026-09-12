import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABORT_RATIO, appendRuns, buildMcpPromptInput, buildSampleNotes, combinations, buildPromptInput,
  createClaudeAdapter, dryRun, fakeAdapter, loadMatrix, outputBasis, plan, promptHash, readPricing,
  readRuns, readTrackedRuns, realRuns, renderPrompt, runMatrix, runsDir, selectAdapter, targetOf, templateText,
  type ChildRun, type EvalRun, type LlmAdapter, type MatrixT,
} from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const matrix = (): MatrixT => loadMatrix(resolve(repoRoot, "eval/matrix.mvp.yaml"), repoRoot);

/** Creates repository-invalid matrix combinations only in temporary files. */
const BASE = [
  "samples: [real-design-system]", "inputVariants: [compact]", "platforms: [css]",
  "repeats: 1", "maxInputTokens: 150000", "model: opus",
].join("\n");
function writeMatrix(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "tl-matrix-")), "m.yaml");
  writeFileSync(path, body, "utf8");
  return path;
}

describe("matrix (SPEC 9.1)", () => {
  it("expands the MVP matrix across three samples, three input variants, and one repeat", () => {
    const m = matrix();
    expect(m.samples).toEqual(["button", "icon-button", "twenty-variants"]);
    expect(m.inputVariants).toEqual(["raw", "compact", "compact+annotations"]);
    expect(m.repeats).toBe(1);
    expect(m.maxInputTokens).toBe(20000);
    expect(combinations(m)).toHaveLength(9);
  });

  it("orders combinations deterministically by sample, input source, and input variant", () => {
    const first = combinations(matrix()).map((c) => `${c.sampleName}/${c.inputVariant}`);
    const second = combinations(matrix()).map((c) => `${c.sampleName}/${c.inputVariant}`);
    expect(first).toEqual(second);
    expect(first[0]).toBe("button/raw");
    expect(first[8]).toBe("twenty-variants/compact+annotations");
  });

  it("decodes version-one matrix keys at the load boundary", () => {
    const path = writeMatrix([
      "fixtures: [button]", "inputs: [snapshot]", "ir: [raw]", "platforms: [css]",
      "repeats: 1", "maxInputTokens: 20000", "model: opus",
    ].join("\n"));

    const loaded = loadMatrix(path, repoRoot);

    expect(loaded.samples).toEqual(["button"]);
    expect(loaded.inputVariants).toEqual(["raw"]);
  });
});

describe("MCP-row matrix definition (SPEC 9.1)", () => {
  it("rejects synthetic test data with its entry name because it has no capture", () => {
    const path = writeMatrix(`${BASE}\ninputs: [snapshot, mcp]\nmcpSets: [{ sampleName: button, node: "12:34" }]\n`);
    expect(() => loadMatrix(path, repoRoot))
      .toThrow("mcpSets[0] button 12:34: expected 1 capture, found 0 []");
  });

  it("rejects a captured variant node with the component-set list", () => {
    // 4185:3779 is a captured Button variant, but only component-set nodes can define MCP rows.
    const path = writeMatrix(`${BASE}\ninputs: [snapshot, mcp]\nmcpSets: [{ sampleName: real-design-system, node: "4185:3779" }]\n`);
    expect(() => loadMatrix(path, repoRoot))
      .toThrow("mcpSets[0] real-design-system 4185:3779: not a componentSets[].id, have [4185:3778, 11:11508, 2072:9432, 185:852]");
  });

  it("reports the expected Snapshot path when the sample directory is absent", () => {
    const path = writeMatrix(`${BASE}\ninputs: [snapshot, mcp]\nmcpSets: [{ sampleName: nope, node: "1:1" }]\n`);
    expect(() => loadMatrix(path, repoRoot)).toThrow("mcpSets[0] nope 1:1: samples/nope/snapshot.json not found");
  });

  it("rejects MCP input with an empty mcpSets list", () => {
    const path = writeMatrix(`${BASE}\ninputs: [snapshot, mcp]\n`);
    expect(() => loadMatrix(path, repoRoot)).toThrow("matrix: inputs has mcp but mcpSets is empty");
  });

  it("creates no MCP rows when only mcpSets is present", () => {
    const path = writeMatrix(`${BASE}\ninputs: [snapshot]\nmcpSets: [{ sampleName: real-design-system, node: "4185:3778" }]\n`);
    const combos = combinations(loadMatrix(path, repoRoot));
    expect(combos.map((c) => c.input)).toEqual(["snapshot"]);
  });

  it("expands listed sets into paired snapshot and variant-free MCP rows", () => {
    // real-design-system has two sets x two design-context variants x two repeats = 8, plus two MCP sets x two repeats = 4.
    // Unlisted button uses its first set x two variants x two repeats = 4, for 16 total.
    const path = writeMatrix([
      "samples: [real-design-system, button]", "inputs: [snapshot, mcp]", "inputVariants: [raw, compact]", "platforms: [css]",
      "repeats: 2", "maxInputTokens: 150000", "model: opus",
      'mcpSets: [{ sampleName: real-design-system, node: "4185:3778" }, { sampleName: real-design-system, node: "11:11508" }]',
    ].join("\n"));

    const combos = combinations(loadMatrix(path, repoRoot));

    expect(combos).toHaveLength(16);
    expect(combos.filter((c) => c.input === "mcp")).toHaveLength(4);
    expect(combos.filter((c) => c.input === "mcp").every((c) => c.inputVariant === "-")).toBe(true);
    expect(combos.filter((c) => c.sampleName === "button").every((c) => c.node === undefined)).toBe(true);
  });

  it("gives each combination a unique target while preserving the legacy unlisted-sample format", () => {
    // Targets exclude repeat; repeat distinguishes two rows for one target (SPEC 9.6 combinations).
    const path = writeMatrix([
      "samples: [real-design-system, button]", "inputs: [snapshot, mcp]", "inputVariants: [raw, compact]", "platforms: [css]",
      "repeats: 2", "maxInputTokens: 150000", "model: opus",
      'mcpSets: [{ sampleName: real-design-system, node: "4185:3778" }, { sampleName: real-design-system, node: "11:11508" }]',
    ].join("\n"));

    const combos = combinations(loadMatrix(path, repoRoot));
    const targets = combos.map(targetOf);

    expect(new Set(combos.map((c) => `${targetOf(c)}.r${String(c.repeat)}`)).size).toBe(combos.length);
    expect([...new Set(targets)].sort()).toEqual([
      "button/compact", "button/raw",
      "real-design-system/11:11508/compact", "real-design-system/11:11508/mcp", "real-design-system/11:11508/raw",
      "real-design-system/4185:3778/compact", "real-design-system/4185:3778/mcp", "real-design-system/4185:3778/raw",
    ]);
  });
});

describe("prompt (SPEC 9.4)", () => {
  it("preserves the SPEC 9.4 template and a stable hash", () => {
    const text = templateText(repoRoot);
    expect(text).toContain("Output exactly two fenced blocks");
    expect(text).toContain("{{block}}");
    expect(text).toContain("{{ir}}");
    expect(promptHash(text)).toBe(promptHash(templateText(repoRoot)));
  });

  it("uses component-set JSON for raw and design context for compact", () => {
    const raw = buildPromptInput(repoRoot, "button", "raw");
    const compact = buildPromptInput(repoRoot, "button", "compact");
    expect(raw.block).toBe("button");
    expect(raw.context).toContain('"componentPropertyDefinitions"'.slice(0, 1));
    expect(raw.context.length).toBeGreaterThan(compact.context.length);
    expect(compact.context).toContain('"tokensUsed"');
  });

  it("includes annotations only for compact+annotations", () => {
    expect(buildPromptInput(repoRoot, "button", "compact").context).not.toContain("aria-disabled");
    expect(buildPromptInput(repoRoot, "button", "compact+annotations").context).toContain("aria-disabled");
  });

  it("loads the requested node instead of the first set", () => {
    const first = buildPromptInput(repoRoot, "real-design-system", "compact");
    const danger = buildPromptInput(repoRoot, "real-design-system", "compact", "185:852");
    expect(first.component).toBe("Button");
    expect(danger.component).toBe("Button Danger");
    expect(danger.block).toBe("button-danger");
  });

  it("uses captured tool_result input without snapshot design context or tools/list", () => {
    const mcp = buildMcpPromptInput(repoRoot, "real-design-system", "4185:3778");

    // Captured tool results are an array while the snapshot set is an object.
    expect(mcp.context[0]).toBe("[");
    expect((JSON.parse(mcp.context) as { name: string }[]).map((r) => r.name)).toEqual([
      "ToolSearch", "mcp__figma__get_variable_defs", "mcp__figma__get_metadata", "mcp__figma__get_design_context",
    ]);
    // tools/list describes server capabilities rather than node content; get_screenshot appears only there.
    expect(mcp.context).not.toContain("mcp__figma__get_screenshot");
    expect(mcp.context).not.toContain("tokensUsed");
    expect(mcp.block).toBe("button");
  });

  it("fills the byte-preserved version-one context placeholder", () => {
    const out = renderPrompt("block={{block}} legacy={{ir}}", {
      block: "b", context: "I", sampleName: "f", component: "C",
    });
    expect(out).toBe("block=b legacy=I");
  });
});

describe("adapter (SPEC 9.2)", () => {
  it("selects the fake adapter for TOKENLOOM_LLM=fake", () => {
    expect(selectAdapter({ TOKENLOOM_LLM: "fake" }).kind).toBe("fake");
    expect(selectAdapter({}).kind).toBe("claude");
  });

  it("returns the fixed test response from the fake adapter", async () => {
    const result = await fakeAdapter.run("prompt", { sampleName: "button", model: "opus", repoRoot });
    expect(result.text).toContain("```css");
    expect(result.text).toContain("```html");
    expect(result.costUsd).toBe(0);
  });

  it("returns an error instead of throwing for missing fake test data", async () => {
    const result = await fakeAdapter.run("p", { sampleName: "nope", model: "opus", repoRoot });
    expect(result.error).toBe("no fake response for nope");
    expect(result.text).toBe("");
  });
});

/** Fixed shape of a `claude --output-format json` response without making a real call. */
const CLAUDE_JSON = JSON.stringify({
  result: "```css\n:root {}\n```",
  total_cost_usd: 0.0611,
  usage: {
    input_tokens: 4,
    cache_creation_input_tokens: 5564,
    cache_read_input_tokens: 37544,
    output_tokens: 3210,
  },
  modelUsage: { "claude-opus-5": { inputTokens: 4 } },
});

describe("claude adapter child-run injection (SPEC 9.2)", () => {
  const stubRun = (out: { code: number; stdout: string; stderr?: string }): ChildRun =>
    () => Promise.resolve({ code: out.code, stdout: out.stdout, stderr: out.stderr ?? "" });

  // The guard lives in the real implementation, so an injected double still runs in this suite.
  it("maps usage, total_cost_usd, and modelUsage into result fields", async () => {
    const adapter = createClaudeAdapter(stubRun({ code: 0, stdout: CLAUDE_JSON }));

    const result = await adapter.run("프롬프트", { sampleName: "button", model: "opus", repoRoot });

    expect({
      text: result.text, model: result.model, inputTokens: result.inputTokens,
      cacheCreation: result.cacheCreation, cacheRead: result.cacheRead,
      outputTokens: result.outputTokens, costUsd: result.costUsd,
    }).toEqual({
      text: "```css\n:root {}\n```", model: "claude-opus-5", inputTokens: 4,
      cacheCreation: 5564, cacheRead: 37544, outputTokens: 3210, costUsd: 0.0611,
    });
  });

  it("calls claude with the exact SPEC 9.2 command", async () => {
    const calls: [string, string[]][] = [];
    const adapter = createClaudeAdapter((cmd, args) => {
      calls.push([cmd, args]);
      return Promise.resolve({ code: 0, stdout: CLAUDE_JSON, stderr: "" });
    });

    await adapter.run("프롬프트", { sampleName: "button", model: "opus", repoRoot });

    expect(calls).toEqual([[
      "claude",
      ["-p", "프롬프트", "--output-format", "json", "--restricted", "--model", "opus"],
    ]]);
  });

  it("returns an error with zero tokens for a nonzero exit and empty stdout", async () => {
    const adapter = createClaudeAdapter(stubRun({ code: 1, stdout: "", stderr: "credit balance too low" }));

    const result = await adapter.run("프롬프트", { sampleName: "button", model: "opus", repoRoot });

    expect({ error: result.error, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd })
      .toEqual({ error: "exit 1 | credit balance too low", inputTokens: 0, outputTokens: 0, costUsd: null });
  });

  it("keeps the exit code and the stdout a failed call reports its own refusal on", async () => {
    const refusal = '{"type":"result","subtype":"error_max_budget"}';
    const adapter = createClaudeAdapter(stubRun({ code: 1, stdout: refusal, stderr: "" }));

    const result = await adapter.run("프롬프트", { sampleName: "button", model: "opus", repoRoot });

    expect(result.error).toBe(`exit 1 | ${refusal}`);
  });
});

describe("runner", () => {
  it("records the reason and skips combinations above maxInputTokens", async () => {
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 6, adapter: fakeAdapter });
    expect(summary.records).toHaveLength(9);
    expect(summary.sent).toBe(7);
    const skipped = summary.records.filter((r) => r.skipped !== undefined).map((r) => r.target);
    expect(skipped).toEqual(["icon-button/raw", "twenty-variants/raw"]);
    expect(summary.records.every((r) => r.skipped === "MAX_INPUT_TOKENS" || r.bytesOut > 0)).toBe(true);
  });

  it("stores raw responses under TOKENLOOM_RUNS_DIR/out/<utcDate>/<target>.r<repeat>.md", async () => {
    const date = "1970-01-01";
    const outDir = join(runsDir(repoRoot), "out", date);
    rmSync(outDir, { recursive: true, force: true });
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 6, adapter: fakeAdapter, utcDate: date });
    const sent = summary.records.find((r) => r.target === "button/compact");
    expect(sent?.skipped).toBe(undefined);
    const path = join(outDir, "button-compact.r0.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("```css");
    // Skipped combinations produce no response file.
    expect(existsSync(join(outDir, "icon-button-raw.r0.md"))).toBe(false);
    rmSync(outDir, { recursive: true, force: true });
  });

  it("records adapter, model, and promptHash on each run row", async () => {
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 6, adapter: fakeAdapter });
    const first = summary.records[0];
    expect(first?.adapter).toBe("fake");
    expect(first?.cmd).toBe("eval");
    expect(first?.promptHash).toHaveLength(12);
  });

  it("marks remaining runs as BUDGET_STOP when the budget is exhausted", async () => {
    const pricey: LlmAdapter = {
      kind: "claude",
      run: async (_p, ctx) => ({
        text: "x", model: ctx.model, ms: 1, invocation: "test", inputTokens: 1,
        cacheCreation: 0, cacheRead: 0, outputTokens: 1, costUsd: 5,
      }),
    };
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 6, adapter: pricey, budgetUsd: 2 });
    expect(summary.records.filter((r) => r.skipped === "BUDGET_STOP").length).toBeGreaterThan(0);
    expect(summary.sent).toBe(1);
  });

  it("round-trips rows through appendRuns and readRuns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tl-runs-"));
    process.env.TOKENLOOM_RUNS_DIR = dir;
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 6, adapter: fakeAdapter });
    const path = appendRuns(repoRoot, "2026-01-01", summary.records);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(9);
    expect(readRuns(repoRoot)).toHaveLength(9);
  });

  it("decodes version-one run keys at the JSONL read boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "tl-legacy-runs-"));
    mkdirSync(join(root, "runs"), { recursive: true });
    const { sampleName: fixture, inputVariant: irLevel, ...rest } = line("button/raw");
    writeFileSync(join(root, "runs/2026-01-01.jsonl"), JSON.stringify({ ...rest, fixture, irLevel }) + "\n");

    const loaded = readTrackedRuns(root);

    expect(loaded[0]?.sampleName).toBe("button");
    expect(loaded[0]?.inputVariant).toBe("raw");
  });

  it("rejects an unknown input variant at the JSONL read boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "tl-invalid-runs-"));
    mkdirSync(join(root, "runs"), { recursive: true });
    writeFileSync(
      join(root, "runs/2026-01-01.jsonl"),
      JSON.stringify({ ...line("button/full"), inputVariant: "full" }) + "\n",
    );

    expect(() => readTrackedRuns(root)).toThrow(/inputVariant/);
  });
});

/** Minimal row containing only fields used by aggregation tests. */
function line(target: string, extra: Partial<EvalRun> = {}): EvalRun {
  return {
    cmd: "eval", target, utcDate: "2026-09-03", sampleName: target.split("/")[0] ?? "", inputVariant: "raw",
    input: "snapshot", repeat: 0, adapter: "claude", model: "opus", invocation: "claude -p",
    promptHash: "h", bytesIn: 0, bytesOut: 0, ratio: 0, estTokens: 0, inputTokens: 0,
    cacheCreation: 0, cacheRead: 0, outputTokens: 0, costUsd: 0, ms: {}, warnings: 0, ...extra,
  };
}

/** Stores scripted rows under a temporary repository `runs/` and returns its root. */
function writeRunsDir(records: EvalRun[]): string {
  const root = mkdtempSync(join(tmpdir(), "tl-basis-"));
  mkdirSync(join(root, "runs"), { recursive: true });
  writeFileSync(join(root, "runs", "2026-01-01.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return root;
}

describe("cost guard (SPEC 9.6)", () => {
  it("returns runs and estCostUsd without accepting a model adapter", () => {
    const summary = dryRun({ repoRoot, matrix: matrix(), parallel: 6 });
    expect(summary.runs).toBe(9);
    expect(summary.sendable).toBe(7);
    expect(summary.estInputTokens).toBeGreaterThan(0);
    expect(summary.byInput).toEqual([
      { input: "snapshot", runs: 9, sendable: 7, estInputTokens: summary.estInputTokens },
    ]);
    // Pricing makes the value non-null; eval/pricing.json remains authoritative for rates.
    expect(Number(summary.estCostUsd)).toBeGreaterThan(0);
  });

  it("splits --dry-run details by input path with totals equal to the whole", () => {
    const path = writeMatrix([
      "samples: [real-design-system]", "inputs: [snapshot, mcp]", "inputVariants: [compact]", "platforms: [css]",
      "repeats: 1", "maxInputTokens: 150000", "model: opus",
      'mcpSets: [{ sampleName: real-design-system, node: "4185:3778" }, { sampleName: real-design-system, node: "11:11508" }]',
    ].join("\n"));

    const summary = dryRun({ repoRoot, matrix: loadMatrix(path, repoRoot), parallel: 6 });

    expect(summary.byInput.map((b) => [b.input, b.runs, b.sendable])).toEqual([["mcp", 2, 2], ["snapshot", 2, 2]]);
    expect(summary.byInput.reduce((sum, b) => sum + b.estInputTokens, 0)).toBe(summary.estInputTokens);
  });

  it("estimates output from the mean of sent matching-hash rows and pricing rates", () => {
    // Use scripted temporary rows as the baseline instead of committed rows.
    // Sent h1 rows have output tokens [100, 300, 500], so their mean is 300.
    // Exclude h2 and the skipped h1 row.
    const basisRuns = readTrackedRuns(writeRunsDir([
      line("a/raw", { promptHash: "h1", outputTokens: 100 }),
      line("b/raw", { promptHash: "h1", outputTokens: 300 }),
      line("c/raw", { promptHash: "h1", outputTokens: 500 }),
      line("d/raw", { promptHash: "h2", outputTokens: 1000 }),
      line("e/raw", { promptHash: "h1", outputTokens: 9999, skipped: "MAX_INPUT_TOKENS" }),
    ]));

    const basis = outputBasis(basisRuns, "opus", "h1");

    expect(basis).toEqual({ promptHash: "h1", lines: 3, outputTokensMean: 300 });
  });

  it("multiplies the baseline mean by sendable combinations and output rate", () => {
    // dryrun-cost.test.ts covers input coefficients; this test isolates the output side.
    const hash = promptHash(templateText(repoRoot));
    const basisRuns = readTrackedRuns(writeRunsDir([
      line("a/raw", { promptHash: hash, outputTokens: 300, estTokens: 1000, cacheCreation: 4000, cacheRead: 10000 }),
      line("b/raw", { promptHash: hash, outputTokens: 300, estTokens: 2000, cacheCreation: 5000, cacheRead: 10000 }),
    ]));
    const rate = readPricing(repoRoot)?.models.opus;

    const summary = dryRun({ repoRoot, matrix: matrix(), parallel: 6, basisRuns });

    // Seven of nine MVP combinations are sendable, so 300 x 7 = 2,100.
    expect(summary.estOutputTokens).toBe(2100);
    expect(summary.estOutputCostUsd).toBe(Number(((2100 / 1_000_000) * (rate?.outputPerMTok ?? 0)).toFixed(4)));
    expect(summary.estTotalCostUsd)
      .toBe(Number(((summary.estCostUsd ?? 0) + (summary.estOutputCostUsd ?? 0)).toFixed(4)));
    expect(summary.outputBasis.promptHash).toBe(summary.promptHash);
  });

  it("uses the mean rather than median for a skewed total estimate", () => {
    // [100, 300, 500, 5100] has median 300, but total estimation requires mean 1,500.
    const basisRuns = readTrackedRuns(writeRunsDir([
      line("a/raw", { outputTokens: 100 }), line("b/raw", { outputTokens: 300 }),
      line("c/raw", { outputTokens: 500 }), line("d/raw", { outputTokens: 5100 }),
    ]));

    const basis = outputBasis(basisRuns, "opus", "h");

    expect(basis).toEqual({ promptHash: "h", lines: 4, outputTokensMean: 1500 });
  });

  it("returns null output estimates and total cost without matching hash or model rows", () => {
    const basisRuns = readTrackedRuns(writeRunsDir([line("a/raw", { model: "haiku", outputTokens: 300 })]));

    const summary = dryRun({ repoRoot, matrix: matrix(), parallel: 6, basisRuns });

    expect({
      basis: summary.outputBasis, out: summary.estOutputTokens,
      outUsd: summary.estOutputCostUsd, total: summary.estTotalCostUsd,
    }).toEqual({
      basis: { promptHash: null, lines: 0, outputTokensMean: null }, out: null, outUsd: null, total: null,
    });
    // Input cost uses the same baseline and is also null, leaving only the token total.
    expect(summary.estCostUsd).toBe(null);
    expect(summary.estInputTokens).toBeGreaterThan(0);
  });

  it("uses model-matched rows with another hash and reports a null baseline hash", () => {
    const basisRuns = readTrackedRuns(writeRunsDir([
      line("a/raw", { promptHash: "unmatched-hash", outputTokens: 700 }),
    ]));

    const summary = dryRun({ repoRoot, matrix: matrix(), parallel: 6, basisRuns });

    expect(summary.outputBasis).toEqual({ promptHash: null, lines: 1, outputTokensMean: 700 });
    expect(summary.estOutputTokens).toBe(4900);
  });

  it("reads four model rates with the pricing verification date", () => {
    const pricing = readPricing(repoRoot);
    expect(Object.keys(pricing?.models ?? {}).sort()).toEqual(["opus", "sonnet"]);
    // eval/pricing.json owns values; this checks only relationships defined by the pricing page.
    expect(Object.values(pricing?.models ?? {}).every(
      (r) => 0 < r.cacheReadPerMTok && r.cacheReadPerMTok < r.inputPerMTok
        && r.inputPerMTok < r.cacheWrite1hPerMTok && r.cacheWrite1hPerMTok < r.outputPerMTok,
    )).toBe(true);
    expect(pricing?.source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pricing?.source.url.startsWith("https://")).toBe(true);
  });

  it("records MCP input with no input variant", () => {
    const path = writeMatrix([
      "samples: [real-design-system]", "inputs: [mcp]", "inputVariants: [compact]", "platforms: [css]",
      "repeats: 1", "maxInputTokens: 150000", "model: opus",
      'mcpSets: [{ sampleName: real-design-system, node: "2072:9432" }]',
    ].join("\n"));

    const planned = plan({ repoRoot, matrix: loadMatrix(path, repoRoot), parallel: 1 }, fakeAdapter.kind);

    expect(planned.map((item) => [item.record.target, item.record.input, item.record.inputVariant]))
      .toEqual([["real-design-system/2072:9432/mcp", "mcp", "-"]]);
  });

  it("stops before exceeding 110% and marks remaining runs BUDGET_STOP", async () => {
    const perCall = 1;
    const pricey: LlmAdapter = {
      kind: "claude",
      run: async (_p, ctx) => ({
        text: "x", model: ctx.model, ms: 1, invocation: "test", inputTokens: 1,
        cacheCreation: 0, cacheRead: 0, outputTokens: 1, costUsd: perCall,
      }),
    };
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 1, adapter: pricey, budgetUsd: 3 });
    // A budget of 3 aborts at 3.3, so $1 calls stop after three sends.
    expect(summary.costUsd).toBeLessThanOrEqual(3 * ABORT_RATIO);
    expect(summary.sent).toBe(3);
    expect(summary.records.filter((r) => r.skipped === "BUDGET_STOP")).toHaveLength(4);
  });

  it("sends every combination when no budget is configured", async () => {
    const summary = await runMatrix({ repoRoot, matrix: matrix(), parallel: 6, adapter: fakeAdapter });
    expect(summary.records.filter((r) => r.skipped === "BUDGET_STOP")).toHaveLength(0);
  });
});

/**
 * Minimal repository root containing only files read by `send`. Cases differ by the presence of
 * `reference/css/tokens.css`, whose absence can no longer be reproduced with committed samples.
 */
const EVAL_ROOT_FILES = [
  "packages/eval/prompts/css.md",
  "packages/eval/samples/fake-responses/button.md",
  "samples/button/snapshot.json",
];
const TOKENS_CSS_REL = "samples/button/reference/css/tokens.css";

function evalRoot(withTokensCss: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "tl-eval-root-"));
  for (const rel of withTokensCss ? [...EVAL_ROOT_FILES, TOKENS_CSS_REL] : EVAL_ROOT_FILES) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(resolve(repoRoot, rel), join(root, rel));
  }
  return root;
}

const BUTTON_MATRIX = [
  "samples: [button]", "inputs: [snapshot]", "inputVariants: [compact]", "platforms: [css]",
  "repeats: 1", "maxInputTokens: 150000", "model: opus",
].join("\n");

function buttonRun(root: string): Promise<{ records: EvalRun[] }> {
  const path = writeMatrix(BUTTON_MATRIX);
  return runMatrix({ repoRoot: root, matrix: loadMatrix(path, root), parallel: 1, adapter: fakeAdapter });
}

describe("S1 for samples without tokens.css (SPEC 9.5)", () => {
  it("records null s1 when reference/css/tokens.css is absent", async () => {
    const summary = await buttonRun(evalRoot(false));

    expect(summary.records[0]?.s1).toBe(null);
  });

  it("records numeric s1 for the same response when reference/css/tokens.css exists", async () => {
    const summary = await buttonRun(evalRoot(true));

    expect(summary.records[0]?.s1).toBe(1);
  });

  it("serializes null s1 as null instead of folding it to zero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tl-runs-null-"));
    process.env.TOKENLOOM_RUNS_DIR = dir;
    const summary = await buttonRun(evalRoot(false));

    const path = appendRuns(repoRoot, "2026-01-01", summary.records);

    expect(readFileSync(path, "utf8")).toContain('"s1":null');
  });
});

describe("rescored rows in the dry-run baseline (SPEC 9.6)", () => {
  it("counts an original and its rescore once so one response is not two samples", () => {
    const root = evalRoot(true);
    const original = line("button/compact", {
      promptHash: promptHash(templateText(repoRoot)), estTokens: 1000, cacheCreation: 4000, outputTokens: 300,
    });
    const rescored = { ...original, s1: 1, rescored: { at: "2026-09-06", reason: "rescored from an archived response" } };
    mkdirSync(join(root, "runs"), { recursive: true });
    writeFileSync(
      join(root, "runs", "2026-09-05.jsonl"),
      [original, rescored].map((r) => JSON.stringify(r)).join("\n") + "\n",
    );

    const summary = dryRun({ repoRoot: root, matrix: loadMatrix(writeMatrix(BUTTON_MATRIX), root), parallel: 1 });

    expect(summary.outputBasis.lines).toBe(1);
  });
});

describe("report aggregation (SPEC 9.6)", () => {
  it("removes an earlier skipped row after the same combination is sent", () => {
    const kept = realRuns([
      line("icon-button/raw", { skipped: "MAX_INPUT_TOKENS" }),
      line("twenty-variants/raw", { skipped: "MAX_INPUT_TOKENS" }),
      line("icon-button/raw", { costUsd: 0.63 }),
    ]);
    expect(kept.map((r) => `${r.target} ${r.skipped ?? "sent"}`)).toEqual([
      "twenty-variants/raw MAX_INPUT_TOKENS",
      "icon-button/raw sent",
    ]);
  });

  it("keeps same-day rows from another set out after promptHash filtering", () => {
    const rows = [
      line("button/compact", { promptHash: "old12345678", costUsd: 0.07 }),
      line("button/compact", { promptHash: "new12345678", costUsd: 0.09 }),
      line("button/raw", { promptHash: "new12345678", costUsd: 0.11 }),
    ];
    expect(realRuns(rows, undefined, "new12345678").map((r) => r.costUsd)).toEqual([0.09, 0.11]);
    expect(realRuns(rows, undefined, "old12345678").map((r) => r.costUsd)).toEqual([0.07]);
    expect(realRuns(rows)).toHaveLength(3);
  });

  it("retains skipped rows for combinations that have not been sent", () => {
    const kept = realRuns([line("icon-button/raw", { skipped: "MAX_INPUT_TOKENS" })]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.skipped).toBe("MAX_INPUT_TOKENS");
  });

  it("counts combinations rather than run rows", () => {
    const notes = buildSampleNotes([
      line("icon-button/raw", { skipped: "MAX_INPUT_TOKENS" }),
      line("icon-button/raw", { costUsd: 0.63 }),
      line("button/raw", { costUsd: 0.11 }),
    ]);
    expect(notes[0]).toBe("combinations: 2");
    expect(notes[1]).toBe("sent: 2");
    expect(notes[3]).toBe("total cost usd: 0.7400");
  });
});
