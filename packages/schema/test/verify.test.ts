import { describe, expect, it } from "vitest";
import { ALL_GATES, GateId } from "../src/verify";

describe("verification gate identifiers", () => {
  it("names every gate for the property it protects", () => {
    expect(GateId.options).toEqual([
      "types", "patterns", "tests", "reference", "determinism", "properties", "mutations",
      "rules", "benchmarks", "scope", "scoring", "encoding", "selftest",
    ]);
  });

  it("rejects a phase-era gate identifier", () => {
    expect(GateId.safeParse("G09").success).toBe(false);
  });

  it("reports every declared gate, so none can be silently dropped from a run", () => {
    expect(ALL_GATES).toEqual(GateId.options);
  });
});
