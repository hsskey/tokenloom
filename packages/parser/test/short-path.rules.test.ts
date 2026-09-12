import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot, stableJsonFile, type DesignContextT } from "@tokenloom/schema";
import * as parser from "../src/index";

const root = resolve(import.meta.dirname, "../../..");

/** The Variant-heavy sample the A11 delta-path experiment is stated against, built as its locked reference was. */
function chipContext(): DesignContextT {
  const snapshot = Snapshot.parse(JSON.parse(readFileSync(resolve(root, "samples/twenty-variants/snapshot.json"), "utf8")));
  const result = parser.buildDesignContext(snapshot, { name: "Chip", annotations: true });
  if (!result.ok) throw new Error(`twenty-variants did not build a design context: ${result.error.kind}`);
  return result.context;
}

function deltaPaths(context: DesignContextT): string[] {
  return context.component.variants.flatMap((variant) => (variant.delta ?? []).map((delta) => delta.path));
}

describe("A11 experimental delta-path representation", () => {
  it("A11: the canonical design context still serializes to its locked reference bytes", () => {
    expect(stableJsonFile(chipContext())).toBe(
      readFileSync(resolve(root, "samples/twenty-variants/reference/context.compact.json"), "utf8"),
    );
  });

  it("A11: every delta the builder emits keeps the RFC 6901 path spelling", () => {
    expect([...new Set(deltaPaths(chipContext()))].sort()).toEqual(["/layout/gap", "/style/bg"]);
  });

  it("A11: the parser surface exports no short-path encoder for the rejected experiment", () => {
    expect(Object.keys(parser).filter((name) => name.toLowerCase().includes("shortpath"))).toEqual([]);
  });
});
