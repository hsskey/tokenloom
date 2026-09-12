import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { combinations, loadMatrix, targetOf } from "../src/matrix";
import { buildPromptInput } from "../src/prompt";
import { buildFailures, readThresholds } from "../src/stats";
import type { EvalRun } from "../src/runs";

const repoRoot = resolve(import.meta.dirname, "../../..");

/** Writes a matrix whose only distinguishing content is its input-variant list. */
function matrixWith(inputVariants: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "tl-matrix-")), "matrix.yaml");
  writeFileSync(path, [
    "samples: [button]", "inputs: [snapshot]", `inputVariants: [${inputVariants}]`,
    "platforms: [css]", "repeats: 1", "maxInputTokens: 20000", "model: opus",
  ].join("\n") + "\n");
  return path;
}

describe("Agent evaluation input variant", () => {
  it("expands an agent row and names its target", () => {
    const matrix = loadMatrix(matrixWith("agent"), repoRoot);

    const expanded = combinations(matrix);

    expect(expanded).toHaveLength(1);
    expect(targetOf(expanded[0] as (typeof expanded)[number])).toBe("button/agent");
  });

  it("rejects an input variant that is not one of the four recorded names", () => {
    expect(() => loadMatrix(matrixWith("agent-json"), repoRoot)).toThrow(/inputVariants/);
  });

  it("pairs the annotated canonical context with the agent view in the committed P6 matrix", () => {
    const matrix = loadMatrix(resolve(repoRoot, "eval/matrix.agent-view.yaml"), repoRoot);

    expect(matrix.inputVariants).toEqual(["compact+annotations", "agent"]);
    expect(matrix.samples).toEqual(["button", "icon-button", "twenty-variants"]);
  });

  it("keeps the recorded matrices on their original three input variants", () => {
    const mvp = loadMatrix(resolve(repoRoot, "eval/matrix.mvp.yaml"), repoRoot);

    expect(mvp.inputVariants).toEqual(["raw", "compact", "compact+annotations"]);
  });
});

describe("Agent prompt input", () => {
  it("drops the source metadata that canonical design context carries", () => {
    const agent = buildPromptInput(repoRoot, "button", "agent");

    expect(agent.context).not.toContain('"contentHash"');
    expect(agent.context).not.toContain('"fileKey"');
    expect(agent.context).not.toContain('"version"');
  });

  it("keeps the annotations, warnings, and token names of the canonical context", () => {
    const agent = buildPromptInput(repoRoot, "button", "agent");

    expect(agent.context).toContain("aria-disabled");
    expect(agent.context).toContain('"tokensUsed"');
    expect(agent.context).toContain('"warnings"');
  });

  it("is the annotated canonical context minus its two source keys", () => {
    const canonical = buildPromptInput(repoRoot, "button", "compact+annotations");

    const agent = buildPromptInput(repoRoot, "button", "agent");

    const { version: _version, source: _source, ...projected } = JSON.parse(canonical.context) as Record<string, unknown>;
    expect(JSON.parse(agent.context)).toEqual(projected);
    expect(agent.block).toBe(canonical.block);
  });

  it("reports a low agent S1 as a design-context defect rather than a property of the input", () => {
    const failures = buildFailures([agentRow({ s1: 0.5 })], readThresholds(repoRoot));

    expect(failures[0]?.retryWhen).toBe("design context names every token sub-property the CSS needs");
  });
});

/** Minimal agent row carrying only the fields aggregation reads. */
function agentRow(extra: Partial<EvalRun>): EvalRun {
  return {
    cmd: "eval", target: "button/agent", utcDate: "2026-09-06", sampleName: "button", inputVariant: "agent",
    input: "snapshot", repeat: 0, adapter: "claude", model: "opus", invocation: "claude -p",
    promptHash: "h", bytesIn: 0, bytesOut: 0, ratio: 0, estTokens: 0, inputTokens: 0,
    cacheCreation: 0, cacheRead: 0, outputTokens: 0, costUsd: 0, ms: {}, warnings: 0, ...extra,
  };
}
