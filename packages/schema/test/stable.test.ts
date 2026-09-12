import { describe, expect, it } from "vitest";
import { stableStringify, stableJsonFile } from "../src/stable";
import { estimateTokens, RunRecord } from "../src/run";
import { VerifyReport } from "../src/verify";

describe("stableStringify", () => {
  it("sorts object keys lexicographically", () => {
    expect(stableStringify({ b: 1, a: 2 }, 0)).toBe('{"a":2,"b":1}');
  });

  it("produces identical bytes regardless of insertion order", () => {
    const left = stableStringify({ z: [1, { b: 2, a: 1 }], a: "x" });
    const right = stableStringify({ a: "x", z: [1, { a: 1, b: 2 }] });
    expect(left).toBe(right);
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2], 0)).toBe("[3,1,2]");
  });

  it("omits keys with undefined values", () => {
    expect(stableStringify({ a: undefined, b: 1 }, 0)).toBe('{"b":1}');
  });

  it("matches the documented reference format for two-space indentation and empty containers", () => {
    expect(stableStringify({ a: [], b: {}, c: [1] })).toBe('{\n  "a": [],\n  "b": {},\n  "c": [\n    1\n  ]\n}');
  });

  it("sorts integer-like keys lexicographically instead of using JSON.stringify numeric ordering", () => {
    expect(stableStringify({ "10": 1, "9": 2, "100": 3 }, 0)).toBe('{"10":1,"100":3,"9":2}');
  });

  it("serializes negative zero as zero", () => {
    expect(stableStringify({ a: -0 }, 0)).toBe('{"a":0}');
  });

  it("ends file output with one newline", () => {
    expect(stableJsonFile({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it("preserves Korean strings without escaping them", () => {
    expect(stableStringify({ a: "라벨" }, 0)).toBe('{"a":"라벨"}');
  });
});

describe("RunRecord and VerifyReport", () => {
  it("requires the RunRecord keys from docs/reference/spec.md section 8", () => {
    const rec = RunRecord.parse({
      cmd: "context", target: "Button", bytesIn: 312400, bytesOut: 6120,
      ratio: 51, estTokens: 1530, ms: { load: 12, compact: 8 }, warnings: 0,
    });
    expect(rec.ratio).toBe(51);
    expect(RunRecord.safeParse({ cmd: "context" }).success).toBe(false);
  });

  it("estimates tokens using the measured bytes-per-token coefficient from docs/reference/spec.md section 2.2", () => {
    expect(estimateTokens(6120)).toBe(2186);
  });

  it("requires a pass value for every VerifyReport gate", () => {
    const report = VerifyReport.parse({
      commit: "abc1234", utc: "2026-09-02T10:00:00Z",
      node: "v22.0.0", os: "linux", durationSec: 43,
      gates: { types: { pass: true, errors: 0 }, scoring: { pass: null } },
    });
    expect(report.gates.types?.pass).toBe(true);
    expect(report.gates.scoring?.pass).toBe(null);
  });
});
