import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../src/snapshot";

const repoRoot = resolve(import.meta.dirname, "../../..");
const buttonPath = resolve(repoRoot, "samples/button/snapshot.json");

function loadButton(): unknown {
  return JSON.parse(readFileSync(buttonPath, "utf8"));
}

describe("Snapshot schema", () => {
  it("accepts the saved button sample as a Snapshot", () => {
    const parsed = Snapshot.parse(loadButton());
    expect(parsed.version).toBe(1);
    expect(parsed.variables).toHaveLength(11);
    expect(parsed.componentSets).toHaveLength(1);
    expect(parsed.componentSets[0]?.components).toHaveLength(2);
    expect(parsed.textStyles[0]?.name).toBe("label/md");
  });

  it("normalizes legacy on-disk source markers to the sample domain term", () => {
    const parsed = Snapshot.parse(loadButton());
    expect(parsed.source.kind).toBe("sample");
    expect(parsed.annotations.every((annotation) => annotation.source === "sample")).toBe(true);
  });

  it("recursively validates component-set roots and their children", () => {
    const parsed = Snapshot.parse(loadButton());
    const root = parsed.componentSets[0]?.components[0]?.root;
    expect(root?.id).toBe("12:35");
    expect(root?.children[0]?.text?.characters).toBe("Button");
    expect(root?.bound.padding).toEqual(["v5", "v6", "v5", "v6"]);
  });

  it("treats RawNode.bound.strokeWeight as optional (docs/reference/spec.md section 4.1)", () => {
    const withWeight = loadButton() as { componentSets: { components: { root: { bound: Record<string, unknown> } }[] }[] };
    const root = withWeight.componentSets[0]?.components[0]?.root;
    if (root !== undefined) root.bound.strokeWeight = "v9";
    expect(Snapshot.parse(withWeight).componentSets[0]?.components[0]?.root.bound.strokeWeight).toBe("v9");
    expect(Snapshot.parse(loadButton()).componentSets[0]?.components[0]?.root.bound.strokeWeight).toBe(undefined);
  });

  it("rejects a Snapshot without source.fileVersion", () => {
    const bad = loadButton() as { source: Record<string, unknown> };
    delete bad.source.fileVersion;
    const result = Snapshot.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["source", "fileVersion"]);
  });

  it("rejects a Snapshot without variable.valuesByMode", () => {
    const bad = loadButton() as { variables: Record<string, unknown>[] };
    delete bad.variables[0]?.valuesByMode;
    const result = Snapshot.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["variables", 0, "valuesByMode"]);
  });

  it("rejects a Snapshot without RawNode.bound", () => {
    const bad = loadButton() as {
      componentSets: { components: { root: Record<string, unknown> }[] }[];
    };
    const root = bad.componentSets[0]?.components[0]?.root;
    delete root?.bound;
    const result = Snapshot.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts unknown node-type strings", () => {
    const open = loadButton() as {
      componentSets: { components: { root: { type: string } }[] }[];
    };
    const root = open.componentSets[0]?.components[0]?.root;
    if (root) root.type = "WIDGET";
    expect(Snapshot.safeParse(open).success).toBe(true);
  });

  it("preserves arbitrary keys in extra", () => {
    const withExtra = loadButton() as {
      componentSets: { components: { root: { extra?: Record<string, unknown> } }[] }[];
    };
    const root = withExtra.componentSets[0]?.components[0]?.root;
    if (root) root.extra = { blendMode: "PASS_THROUGH" };
    const parsed = Snapshot.parse(withExtra);
    expect(parsed.componentSets[0]?.components[0]?.root.extra).toEqual({ blendMode: "PASS_THROUGH" });
  });

  it("preserves read or unsupported as source.annotationsSupport and rejects other values (docs/reference/spec.md section 4.8)", () => {
    const supported = loadButton() as { source: Record<string, unknown> };
    supported.source.annotationsSupport = "read";
    const rejected = loadButton() as { source: Record<string, unknown> };
    rejected.source.annotationsSupport = "supported";
    expect(Snapshot.parse(supported).source.annotationsSupport).toBe("read");
    expect(Snapshot.safeParse(rejected).error?.issues[0]?.path).toEqual(["source", "annotationsSupport"]);
  });
});
