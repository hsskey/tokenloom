import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { listSamples } from "../src/gates/meta";
import { scoring, reportLiterals, trajectoryEvidence } from "../src/gates/tests";
import { listFiles, makeVerifyContext, type VerifyContext } from "../src/verify-context";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "tl-trajectory-evidence-"));
/** The self-test gate empties verify/selftest in every copy, so the overlay case runs only in the real tree. */
const selftestTree = listSamples(repoRoot()).length === 0
  ? [] : ["verify/selftest/scoring/trajectory-handwritten-number/apply"];
/** The nested Vitest run carries its own 600s bound, which must expire before this case does. */
const NESTED_RUN_TIMEOUT_MS = 660_000;
afterAll(() => { rmSync(fixtureRoot, { recursive: true, force: true }); });
const tasks = ["known-component", "unknown-component", "variant-only", "recovery"];
const conditions = ["cli-canonical", "cli-agent", "mcp-agent"];
const tokensCss = ":root {}\n";
const tokensCssSha256 = createHash("sha256").update(tokensCss).digest("hex");
/** Partition ids are prompt hashes, so a claim names one by its first twelve hex digits. */
const HASH = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", FORMAT_HASH = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const rows = tasks.flatMap((task) => conditions.flatMap((condition) => [0, 1].map((repeat) => JSON.stringify({
  cmd: "trajectory", adapter: "claude", task, condition, repeat, model: "opus", invocation: "claude",
  promptHash: HASH, success: true, turns: 2, durationMs: 20,
  inputTokens: condition === "cli-canonical" ? 100 : 80, cacheCreation: 0, cacheRead: 0, outputTokens: 10,
  costUsd: 0.1, s1: 1, s2: 0.98, artifact: { sampleName: "sample", tokensCssSha256, referenceLockCommit: "LOCK" },
  toolCalls: [], recovery: [],
}))));
const header = "| Condition | Runs | Incomparable | Success rate | Total input p50 | Output p50 | Duration ms p50"
  + " | Turns p50 | Tool calls | Recoveries | Cost p50 | S1 p50 | S2 p50 |";
/** The section renderTrajectoryReport emits for one prompt-hash partition, whose per-condition cost median is `cost`. */
const section = (promptHash: string, cost: string): string => [
  `## prompt ${promptHash} / model opus / invocation claude`, "", header, header.replace(/[^|]+/g, " --- "),
  `| cli-canonical | 8 | 0 | 1.00 | 100 | 10 | 20 | 2 | 0 | 0 | ${cost} | 1.00 | 0.98 |`,
  `| cli-agent | 8 | 0 | 1.00 | 80 | 10 | 20 | 2 | 0 | 0 | ${cost} | 1.00 | 0.98 |`,
  `| mcp-agent | 8 | 0 | 1.00 | 80 | 10 | 20 | 2 | 0 | 0 | ${cost} | 1.00 | 0.98 |`,
].join("\n");
const report = ["# tokenloom trajectory", "", "Total real cost: 2.40", "", section(HASH, "0.10"), ""].join("\n");
const claimOf = (condition: string, hash: string): string => `adopted: ${condition} @${hash.slice(0, 12)}`;

function fixture(name: string, runLines: string[], body: string | null, trackManifest = true): VerifyContext {
  const root = join(fixtureRoot, name);
  const manifest = join(root, "samples/manifest.json");
  mkdirSync(join(root, "samples/sample/reference/css"), { recursive: true });
  writeFileSync(join(root, "samples/sample/reference/css/tokens.css"), tokensCss, "utf8");
  if (trackManifest) writeFileSync(manifest, "{}\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root });
  const lock = execFileSync("git", ["log", "-1", "--format=%H", "--", "samples/manifest.json"], { cwd: root, encoding: "utf8" }).trim();
  if (!trackManifest) writeFileSync(manifest, "{}\n", "utf8");
  mkdirSync(join(root, "runs"), { recursive: true });
  writeFileSync(join(root, "runs/trajectory.jsonl"), `${runLines.join("\n").replaceAll("LOCK", lock)}\n`, "utf8");
  if (body !== null) {
    mkdirSync(join(root, "reports"), { recursive: true });
    writeFileSync(join(root, "reports/trajectory.md"), body, "utf8");
  }
  return { ...makeVerifyContext(repoRoot()), root, files: listFiles(root) };
}

describe("trajectory evidence", () => {
  it("rejects a measurement written directly in a report string while ignoring labels", () => {
    const context = fixture("literal", [], null);
    const source = join(context.root, "packages/eval/src/trajectory-report.ts");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, 'export const row = "S1 p50 | S2 p50 | Total input p50 | Success rate: 0.88";\n', "utf8");
    context.files = listFiles(context.root);

    expect(reportLiterals(context)).toEqual(["packages/eval/src/trajectory-report.ts: 0.88"]);
  });

  it.each([["declaration", "const RATE = .88;"], ["string", 'const row = "rate .88";']])(
    "rejects a leading-dot decimal written into a report code %s", (name, source) => {
      const context = fixture(`dot-literal-${name}`, [], null);
      const file = join(context.root, "packages/eval/src/trajectory-report.ts");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `export ${source}\n`, "utf8");
      context.files = listFiles(context.root);

      expect(reportLiterals(context)).toEqual(["packages/eval/src/trajectory-report.ts: 88"]);
    },
  );

  it("rejects a measurement written inside a report template expression", () => {
    const context = fixture("template-literal", [], null);
    const file = join(context.root, "packages/eval/src/trajectory-report.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "export const rate = (): string => `Success rate: ${0.88}`;\n", "utf8");
    context.files = listFiles(context.root);

    expect(reportLiterals(context)).toEqual(["packages/eval/src/trajectory-report.ts: 0.88"]);
  });

  it("accepts a complete report recomputed from the required matrix", () => {
    const partition = { promptHash: HASH, invocation: "claude", model: "opus" };

    expect(trajectoryEvidence(fixture("complete", rows, report))).toEqual({
      errors: [],
      trajectoryCriteria: {
        cost: { total: expect.closeTo(2.4), required: [expect.closeTo(2.4)], excluded: 0 },
        conditions: [{
          "cli-agent": { adopted: true, complete: true, partition },
          "mcp-agent": { adopted: true, complete: true, partition },
        }],
      },
    });
  });

  it("bounds each partition by its own required cost when a separately approved matrix is committed beside it", () => {
    const format = rows.map((line) => JSON.stringify({ ...JSON.parse(line), promptHash: FORMAT_HASH, costUsd: 0.15 }));
    const compact = format.filter((line) => line.includes('"condition":"cli-agent"'))
      .map((line) => JSON.stringify({ ...JSON.parse(line), condition: "cli-agent-compact", costUsd: 0.4 }));
    const both = ["# tokenloom trajectory", "", "Total real cost: 9.20", "", section(HASH, "0.10"), "",
      section(FORMAT_HASH, "0.15"), "| cli-agent-compact | 8 | 0 | 1.00 | 80 | 10 | 20 | 2 | 0 | 0 | 0.40 | 1.00 | 0.98 |", ""].join("\n");

    expect(trajectoryEvidence(fixture("superset", [...rows, ...format, ...compact], both))).toMatchObject({
      errors: [],
      trajectoryCriteria: {
        cost: { total: expect.closeTo(9.2), required: [expect.closeTo(2.4), expect.closeTo(3.6)], excluded: expect.closeTo(3.2) },
        conditions: [{ "cli-agent": { adopted: true }, "mcp-agent": { adopted: true } },
          { "cli-agent": { adopted: true }, "mcp-agent": { adopted: true } }],
      },
    });
  });

  it("rejects a report number that disagrees with the run records", () => {
    const evidence = trajectoryEvidence(fixture("false-total", rows, report.replace("2.40", "9.99")));

    expect(evidence.errors).toEqual(["trajectory report measurements disagree: Total real cost: 9.99"]);
  });

  it("rejects numeric report content outside the computed report format", () => {
    const evidence = trajectoryEvidence(fixture("extra-number", rows, `${report}Input reduction: 99%\n`));

    expect(evidence.errors).toEqual(["trajectory report measurements disagree: Input reduction: 99%"]);
  });

  it("accepts an adoption claim whose named partition meets the criteria", () => {
    const claimed = `${report}${claimOf("cli-agent", HASH)}\n`;

    expect(trajectoryEvidence(fixture("true-adoption", rows, claimed)).errors).toEqual([]);
  });

  it("rejects an adoption claim whose named partition misses the input reduction", () => {
    const lowReduction = rows.map((line) => line.includes('"condition":"cli-agent"')
      ? line.replace('"inputTokens":80', '"inputTokens":90') : line);
    const claim = claimOf("cli-agent", HASH);
    const claimed = `${report.replace("| 80 | 10", "| 90 | 10")}${claim}\n`;

    expect(trajectoryEvidence(fixture("false-adoption", lowReduction, claimed)).errors).toEqual([
      `trajectory adoption criteria do not hold: ${claim}`,
    ]);
  });

  it.each([["adopted-first", "Adopted: cli-agent"], ["condition-first", "cli-agent: adopted"],
    ["upper-case", "CLI-AGENT: adopted"], ["bare-canonical", "adopted: cli-agent"]])(
    "rejects the %s claim because it names no partition", (name, claim) => {
      expect(trajectoryEvidence(fixture(`unattributed-${name}`, rows, `${report}${claim}\n`)).errors).toEqual([
        `trajectory adoption criteria do not hold: ${claim}`,
      ]);
    },
  );

  it("rejects an adoption claim naming a partition that has no run records", () => {
    const claim = claimOf("cli-agent", "ffffffffffff0000");

    expect(trajectoryEvidence(fixture("absent-partition", rows, `${report}${claim}\n`)).errors).toEqual([
      `trajectory adoption criteria do not hold: ${claim}`,
    ]);
  });

  /** The claim must be carried by its own partition, never by a second matrix that happens to qualify. */
  it("rejects a claim on a partition that misses the criteria while another partition meets them", () => {
    const lowReduction = rows.map((line) => line.includes('"condition":"cli-agent"')
      ? line.replace('"inputTokens":80', '"inputTokens":90') : line);
    const format = rows.map((line) => JSON.stringify({ ...JSON.parse(line), promptHash: FORMAT_HASH }));
    const body = (claim: string): string => ["# tokenloom trajectory", "", "Total real cost: 4.80", "",
      section(HASH, "0.10").replace("| 80 | 10", "| 90 | 10"), "", section(FORMAT_HASH, "0.10"), claim, ""].join("\n");
    const runLines = [...lowReduction, ...format];

    expect(trajectoryEvidence(fixture("cross-partition", runLines, body(claimOf("cli-agent", HASH)))).errors).toEqual([
      `trajectory adoption criteria do not hold: ${claimOf("cli-agent", HASH)}`,
    ]);
    expect(trajectoryEvidence(fixture("own-partition", runLines, body(claimOf("cli-agent", FORMAT_HASH)))).errors).toEqual([]);
  });

  it.each(["- adopted: cli-agent", "**cli-agent**: adopted"])(
    "rejects the claim %s because it is not the one line format the scoring gate verifies", (claim) => {
      expect(trajectoryEvidence(fixture(`informal-${claim[0]}`, rows, `${report}${claim}\n`)).errors).toEqual([
        `trajectory adoption criteria do not hold: ${claim}`,
      ]);
    },
  );

  it("rejects a leading-dot decimal stated outside the computed report format", () => {
    const evidence = trajectoryEvidence(fixture("dot-number", rows, `${report}Input ratio .85 of canonical\n`));

    expect(evidence.errors).toEqual(["trajectory report measurements disagree: Input ratio .85 of canonical"]);
  });

  it("rejects a number glued to a word outside the computed report format", () => {
    const evidence = trajectoryEvidence(fixture("glued-number", rows, `${report}cli-agent uses 2x fewer tokens\n`));

    expect(evidence.errors).toEqual(["trajectory report measurements disagree: cli-agent uses 2x fewer tokens"]);
  });

  it("accepts a run record whose repeat index lies outside the two-repeat adoption matrix", () => {
    const thirdRepeat = rows.map((line, index) => index === 0 ? JSON.stringify({ ...JSON.parse(line), repeat: 2 }) : line);

    expect(trajectoryEvidence(fixture("third-repeat", thirdRepeat, report)).errors).toEqual([]);
  });

  it.each([["inputTokens", -1], ["costUsd", -0.1], ["s1", -0.1], ["s2", 1.1], ["repeat", -1], ["repeat", 1.5]])(
    "rejects an out-of-domain %s measurement", (field, value) => {
      const invalid = rows.map((line, index) => index === 0 ? JSON.stringify({ ...JSON.parse(line), [field]: value }) : line);

      expect(trajectoryEvidence(fixture(`invalid-${field}`, invalid, report)).errors).toEqual(["invalid trajectory run record"]);
    },
  );

  it.each(["missing artifact", "stale reference lock"])("withholds adoption when a row has a %s", (defect) => {
    const unverifiable = rows.map((line, index) => index !== 2 ? line : defect === "missing artifact"
      ? JSON.stringify({ ...JSON.parse(line), artifact: null })
      : line.replace('"referenceLockCommit":"LOCK"', '"referenceLockCommit":"STALE"'));
    const evidence = trajectoryEvidence(fixture(`provenance-${defect[0]}`, unverifiable, report));

    expect(evidence).toMatchObject({ errors: [], trajectoryCriteria: { conditions: [{ "cli-agent": { adopted: false, complete: false } }] } });
  });

  it("withholds adoption when a recorded tokens.css hash disagrees with the locked sample", () => {
    const mismatched = rows.map((line, index) => index === 2
      ? line.replace(tokensCssSha256, "0".repeat(tokensCssSha256.length)) : line);
    const evidence = trajectoryEvidence(fixture("hash-mismatch", mismatched, report));

    expect(evidence).toMatchObject({ errors: [], trajectoryCriteria: { conditions: [{ "cli-agent": { adopted: false, complete: false } }] } });
  });

  it("does not form an adoption median from one of eight scored rows", () => {
    const keepScore = '"task":"known-component","condition":"cli-agent","repeat":0';
    const partial = rows.map((line) => line.includes('"condition":"cli-agent"') && !line.includes(keepScore)
      ? line.replace('"s1":1', '"s1":null') : line);
    const evidence = trajectoryEvidence(fixture("partial-scores", partial, report));

    expect(evidence).toMatchObject({ errors: [], trajectoryCriteria: { conditions: [{ "cli-agent": { adopted: false, complete: false } }] } });
  });

  it("names the condition row that disagrees rather than the first report line", () => {
    const wrongRow = report.replace("| mcp-agent | 8 | 0 | 1.00 | 80 |", "| mcp-agent | 8 | 0 | 1.00 | 70 |");

    expect(trajectoryEvidence(fixture("wrong-row", rows, wrongRow)).errors).toEqual([
      "trajectory report measurements disagree: | mcp-agent | 8 | 0 | 1.00 | 70 | 10 | 20 | 2 | 0 | 0 | 0.10 | 1.00 | 0.98 |",
    ]);
  });

  it("accepts a run record recorded under the cli-agent-compact condition", () => {
    const compact = rows.map((line) => line.replace('"condition":"cli-agent"', '"condition":"cli-agent-compact"'));

    expect(trajectoryEvidence(fixture("compact", compact, report.replaceAll("| cli-agent |", "| cli-agent-compact |"))))
      .toMatchObject({ errors: [] });
  });

  it("verifies provenance against the locked tokens.css rather than the working tree", () => {
    const context = fixture("worktree-mutation", rows, report);
    writeFileSync(join(context.root, "samples/sample/reference/css/tokens.css"), ":root { --x: 1px }\n", "utf8");

    expect(trajectoryEvidence(context)).toMatchObject({
      errors: [], trajectoryCriteria: { conditions: [{ "cli-agent": { adopted: true, complete: true } }] },
    });
  });

  it("verifies no row when the reference lock does not resolve to a commit", () => {
    const evidence = trajectoryEvidence(fixture("no-lock", rows, report, false));

    expect(evidence).toMatchObject({ errors: [], trajectoryCriteria: { conditions: [{ "cli-agent": { adopted: false, complete: false } }] } });
  });

  it("withholds adoption when the eight rows of a condition repeat one task instead of covering four", () => {
    const singleTask = rows.map((line, i) => JSON.stringify({
      ...JSON.parse(line), task: "known-component", repeat: Math.floor(i / 6) * 2 + i % 2 }));

    expect(trajectoryEvidence(fixture("single-task", singleTask, report))).toMatchObject({
      errors: [], trajectoryCriteria: { conditions: [{ "cli-agent": { adopted: false, complete: false } }] },
    });
  });

  it("names the run file and line of a record that does not parse rather than blaming the trajectory harness", () => {
    const truncated = trajectoryEvidence(fixture("truncated", [...rows, '{"cmd":"eval","sampleName":'], report));

    expect(truncated).toEqual({
      errors: ["unparsable run record: runs/trajectory.jsonl:25"], trajectoryCriteria: "not evaluated",
    });
  });

  it("fails when trajectory run records exist without the documented report path", () => {
    expect(trajectoryEvidence(fixture("missing-report", rows, null))).toEqual({
      errors: ["report missing: reports/trajectory.md"], trajectoryCriteria: "not evaluated",
    });
  });

  it.each(selftestTree)("makes the %s overlay fail through the real scoring gate", async (overlay) => {
    const context = fixture("self-test", [], null);
    const source = join(context.root, "packages/eval/src/trajectory-report.ts");
    mkdirSync(dirname(source), { recursive: true });
    copyFileSync(join(repoRoot(), overlay, "packages/eval/src/trajectory-report.ts"), source);
    mkdirSync(join(context.root, "test"), { recursive: true });
    const cases = [...Array(12).keys()]
      .map((index) => `it("A${String(index + 1).padStart(2, "0")} fixture", () => {});`).join("\n");
    writeFileSync(join(context.root, "test/scorer.adversarial.test.ts"), `import { it } from "vitest";\n${cases}\n`, "utf8");
    symlinkSync(join(repoRoot(), "node_modules"), join(context.root, "node_modules"), "dir");
    context.files = listFiles(context.root);

    await expect(scoring(context)).resolves.toMatchObject({
      pass: false,
      reason: "hand-written number in report code: packages/eval/src/trajectory-report.ts: 0.88",
    });
  }, NESTED_RUN_TIMEOUT_MS);

  it("fails when the committed report has no run records to recompute it from", () => {
    expect(trajectoryEvidence(fixture("orphan-report", [], report))).toEqual({
      errors: ["report without run records"], trajectoryCriteria: "not evaluated",
    });
  });

  it("passes without real trajectory records and records why", () => {
    const evidence = trajectoryEvidence(fixture("no-records", [], null));

    expect(evidence).toEqual({ errors: [], trajectoryCriteria: "trajectory criteria: not evaluated (no records)" });
  });
});
