// Run ratios use the benchmark definition: one component set and indented JSON on both sides.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot, stableJsonFile, stableStringify } from "@tokenloom/schema";
import { buildDesignContext } from "@tokenloom/parser";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");
const BUTTON_SNAPSHOT = resolve(repoRoot, "samples/button/snapshot.json");

/** Run the CLI and read the single record produced by that invocation. */
function contextRunRecord(name: string): { bytesIn: number; bytesOut: number; ratio: number } {
  const runsDir = mkdtempSync(join(tmpdir(), "tl-runs-"));
  const res = spawnSync("node", [CLI, "context", name, "--from", BUTTON_SNAPSHOT, "--annotations"], {
    encoding: "utf8",
    env: { ...process.env, TOKENLOOM_RUNS_DIR: runsDir },
  });
  expect(res.status).toBe(0);
  const file = readdirSync(runsDir).find((f) => f.endsWith(".jsonl"));
  expect(file).toBeTypeOf("string");
  const lines = readFileSync(join(runsDir, file as string), "utf8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1] as string) as ReturnType<typeof contextRunRecord>;
}

/** Recalculate the benchmark ratio independently of the CLI helper. */
function benchRatio(name: string): { bytesIn: number; bytesOut: number; ratio: number } {
  const snapshot = Snapshot.parse(JSON.parse(readFileSync(BUTTON_SNAPSHOT, "utf8")));
  const set = snapshot.componentSets.find((s) => s.name === name);
  if (set === undefined) throw new Error(`${name}: no component set`);
  const result = buildDesignContext(snapshot, { name, annotations: true });
  if (!result.ok) throw new Error(`${name}: ${result.error.kind}`);
  const bytesIn = Buffer.byteLength(stableStringify(set), "utf8");
  const bytesOut = Buffer.byteLength(stableJsonFile(result.context), "utf8");
  return { bytesIn, bytesOut, ratio: Number((bytesIn / bytesOut).toFixed(2)) };
}

describe("Design-context run compression ratio", () => {
  it("run bytesIn, bytesOut, and ratio match the benchmark definition", () => {
    const expected = benchRatio("Button");
    const actual = contextRunRecord("Button");
    expect(actual.bytesIn).toBe(expected.bytesIn);
    expect(actual.bytesOut).toBe(expected.bytesOut);
    expect(actual.ratio).toBe(expected.ratio);
  });

  it("the numerator uses indented JSON with different bytes from minified JSON", () => {
    const snapshot = Snapshot.parse(JSON.parse(readFileSync(BUTTON_SNAPSHOT, "utf8")));
    const set = snapshot.componentSets.find((s) => s.name === "Button");
    const minified = Buffer.byteLength(stableStringify(set, 0), "utf8");
    expect(contextRunRecord("Button").bytesIn).toBeGreaterThan(minified);
  });
});
