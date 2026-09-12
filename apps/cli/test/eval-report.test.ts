// Inspect generated reports to prevent mixed prompt hashes under one header (docs/reference/spec.md section 9.6).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");

/** Build a run record in the shape `eval run` writes today, overriding only the varied fields. */
function line(over: Record<string, unknown>): string {
  return JSON.stringify({
    cmd: "eval", target: "button/compact", utcDate: "2026-09-05", sampleName: "button",
    inputVariant: "compact", input: "snapshot", repeat: 0, adapter: "claude", model: "opus",
    invocation: "claude -p --output-format json --restricted --model <id>",
    promptHash: "c9525a86e192", bytesIn: 2925, bytesOut: 1200, ratio: 2.44, estTokens: 731,
    inputTokens: 2, cacheCreation: 6499, cacheRead: 8853, outputTokens: 681, costUsd: 0.08,
    ms: { llm: 7762 }, warnings: 0, s1: 1, s2: 1, s3: null, ...over,
  });
}

function report(lines: string[], args: string[] = []): { body: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "tl-report-"));
  writeFileSync(join(dir, "2026-09-05.jsonl"), lines.join("\n") + "\n");
  const out = join(dir, "report.md");
  const res = spawnSync("node", [CLI, "eval", "report", "--out", out, ...args], {
    encoding: "utf8", env: { ...process.env, TOKENLOOM_RUNS_DIR: dir },
  });
  expect(res.status).toBe(0);
  return { body: readFileSync(out, "utf8"), stderr: res.stderr };
}

function headers(body: string): string[] {
  return body.split("\n").filter((l) => l.startsWith("# "));
}

describe("eval report sections by prompt hash (docs/reference/spec.md section 9.6)", () => {
  it("two prompt hashes produce two headers identifying their own hashes", () => {
    const { body, stderr } = report([
      line({ promptHash: "57dcdf29f1ed", target: "button/raw", inputVariant: "raw" }),
      line({}),
    ]);

    expect(headers(body).map((h) => h.split(" / ")[2])).toEqual([
      "prompt 57dcdf29f1ed", "prompt c9525a86e192",
    ]);
    expect(stderr).toContain("2 runs in 2 sections");
  });

  it("one prompt hash produces one section and one header", () => {
    const { body } = report([line({}), line({ repeat: 1 })]);

    expect(headers(body)).toHaveLength(1);
  });

  it("--prompt-hash selects only the matching section", () => {
    const { body } = report(
      [line({ promptHash: "57dcdf29f1ed" }), line({})],
      ["--prompt-hash", "c9525a86e192"],
    );

    expect(headers(body)).toEqual([expect.stringContaining("prompt c9525a86e192")]);
  });

  it("headers report model aliases with pricing mappings rather than claiming billed IDs were measured", () => {
    const { body } = report([line({})]);

    expect(headers(body)[0]).toContain(
      "model opus (alias; eval/pricing.json resolvedModel claude-opus-5; id not recorded in run lines)",
    );
  });

  it("sample designs and synthetic test data appear as separate capability rows", () => {
    const { body } = report([
      line({ sampleName: "real-annotated-theme", target: "real-annotated-theme/compact" }),
      line({}),
    ]);

    expect(body).toContain("| Sample designs | snapshot | compact |");
    expect(body).toContain("| Synthetic test data | snapshot | compact |");
  });
  it("reads the retired fixture and irLevel keys from run records written before the rename", () => {
    const record = JSON.parse(line({ target: "real-annotated-theme/compact" })) as Record<string, unknown>;
    const { sampleName: _sampleName, inputVariant: _inputVariant, ...rest } = record;
    const legacy = JSON.stringify({ ...rest, fixture: "real-annotated-theme", irLevel: "compact" });

    const { body } = report([legacy]);

    expect(body).toContain("| Sample designs | snapshot | compact |");
  });
});
