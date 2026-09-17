import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { variantSelectorOf } from "@tokenloom/schema";
import { measureS3, scoreS3, type RenderPort, type VariantShot } from "../src/visual";
import { expectedVariants, variantReferences, type VariantReference } from "../src/variant-reference";
import { runVerdict, readThresholds } from "../src/stats";

const repoRoot = resolve(import.meta.dirname, "../../..");

function solid(rgb: [number, number, number]): Buffer {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < 8 * 8; i += 1) {
    const at = i << 2;
    [png.data[at], png.data[at + 1], png.data[at + 2], png.data[at + 3]] = [rgb[0], rgb[1], rgb[2], 255];
  }
  return PNG.sync.write(png);
}

const WHITE = solid([255, 255, 255]);
const BLACK = solid([0, 0, 0]);

function ref(selector: string, renderPng: string | null, failure?: VariantReference["failure"]): VariantReference {
  return { selector, nodeId: renderPng === null ? null : "n", renderPng, ...(failure === undefined ? {} : { failure }) };
}

function shot(variant: string, png: Buffer): VariantShot {
  return { variant, png };
}

function pngReader(map: Record<string, Buffer>): (path: string) => Buffer {
  return (path) => {
    const value = map[path];
    if (value === undefined) throw new Error(`no png for ${path}`);
    return value;
  };
}

describe("scoreS3 measurement (SPEC 9.5)", () => {
  it("scores identical shots as zero and different shots by the worst variant with the mean recorded", () => {
    const references = [ref("a", "ref-a"), ref("b", "ref-b")];
    const result = scoreS3(
      references, [shot("a", WHITE), shot("b", BLACK)],
      pngReader({ "ref-a": WHITE, "ref-b": WHITE }), ["a", "b"], ["a", "b"],
    );
    expect(result.s3Status).toBe("measured");
    expect(result.s3).toBe(1);
    expect(result.s3Detail.max).toBe(1);
    expect(result.s3Detail.mean).toBe(0.5);
    expect(result.s3Detail.worst).toEqual({ selector: "b", ratio: 1 });
    expect(result.s3Detail.compared).toBe(2);
  });

  it("matches shots to references by selector rather than by index", () => {
    const references = [ref("a", "ref-a"), ref("b", "ref-b")];
    const result = scoreS3(
      references, [shot("b", WHITE), shot("a", BLACK)],
      pngReader({ "ref-a": BLACK, "ref-b": WHITE }), ["b", "a"], ["b", "a"],
    );
    expect(result.s3Status).toBe("measured");
    expect(result.s3).toBe(0);
  });

  it("measures over the rendered intersection when a referenced variant was not rendered", () => {
    const references = [ref("a", "ref-a"), ref("b", "ref-b")];
    const result = scoreS3(references, [shot("a", WHITE)], pngReader({ "ref-a": WHITE }), ["a"], ["a"]);
    expect(result.s3Status).toBe("measured");
    expect(result.s3).toBe(0);
    expect(result.s3Detail.notRendered).toEqual(["b"]);
    expect(result.s3Detail.compared).toBe(1);
  });

  it("returns NO_COMPARABLE_VARIANT when every referenced variant is absent from the output", () => {
    const result = scoreS3([ref("a", "ref-a")], [], pngReader({ "ref-a": WHITE }), [], []);
    expect(result.s3Status).toBe("error");
    expect(result.s3).toBe(null);
    // The gated max stays null over an empty comparison set; a Math.max() default of -Infinity would pass the 0.05 gate.
    expect(result.s3Detail.max).toBe(null);
    expect(result.s3Detail.errors).toEqual([{ selector: null, code: "NO_COMPARABLE_VARIANT" }]);
  });

  it("returns not-applicable when no expected variant records a reference", () => {
    const result = scoreS3([ref("a", null), ref("b", null)], [], pngReader({}), [], []);
    expect(result.s3Status).toBe("not-applicable");
    expect(result.s3).toBe(null);
    expect(result.s3Detail.withReference).toBe(0);
  });

  it.each([
    "NO_SNAPSHOT_COMPONENT", "AMBIGUOUS_SNAPSHOT_COMPONENT", "REFERENCE_FILE_MISSING", "FILENAME_RULE_MISMATCH",
  ] as const)("treats a %s reference failure as an error, never a pass", (code) => {
    const result = scoreS3([ref("a", null, code)], [], pngReader({}), [], []);
    expect(result.s3Status).toBe("error");
    expect(result.s3).toBe(null);
    expect(result.s3Detail.errors).toEqual([{ selector: "a", code }]);
  });

  it("keeps the partial ratios of the good variants when one variant fails to decode", () => {
    const references = [ref("a", "ref-a"), ref("b", "ref-b")];
    const result = scoreS3(
      references, [shot("a", WHITE), shot("b", WHITE)],
      pngReader({ "ref-a": WHITE, "ref-b": Buffer.from("not a png") }), ["a", "b"], ["a", "b"],
    );
    expect(result.s3Status).toBe("error");
    expect(result.s3).toBe(null);
    expect(result.s3Detail.compared).toBe(1);
    expect(result.s3Detail.mean).toBe(0);
    expect(result.s3Detail.errors).toEqual([{ selector: "b", code: "PNG_DECODE_FAILED" }]);
  });

  it("fails with DOM_DISAGREEMENT when the rendered markers differ from the tokenizer", () => {
    const result = scoreS3([ref("a", "ref-a")], [shot("a", WHITE)], pngReader({ "ref-a": WHITE }), ["a"], ["a", "b"]);
    expect(result.s3Status).toBe("error");
    expect(result.s3).toBe(null);
    expect(result.s3Detail.errors).toEqual([{ selector: null, code: "DOM_DISAGREEMENT" }]);
  });
});

describe("variantReferences mapping (SPEC 9.5)", () => {
  it("resolves a node id to its recorded render PNG through the snapshot", () => {
    const expected = expectedVariants(repoRoot, { sampleName: "real-design-system" });
    const references = variantReferences(repoRoot, { sampleName: "real-design-system" }, expected.selectors);
    const primary = references.find((r) => r.nodeId === "4185:3779");
    expect(primary?.failure).toBeUndefined();
    expect(primary?.renderPng).toContain("render/4185-3779.png");
  });

  it("returns a null reference, not a failure, for a sample without render PNGs", () => {
    const expected = expectedVariants(repoRoot, { sampleName: "button" });
    const references = variantReferences(repoRoot, { sampleName: "button" }, expected.selectors);
    expect(references.every((r) => r.renderPng === null && r.failure === undefined)).toBe(true);
  });

  it("reports NO_SNAPSHOT_COMPONENT for a selector no component satisfies", () => {
    const references = variantReferences(repoRoot, { sampleName: "real-design-system" }, ["Size=None"]);
    expect(references[0]?.failure).toBe("NO_SNAPSHOT_COMPONENT");
  });

  describe("against a mutated snapshot", () => {
    const fixture = mkdtempSync(join(tmpdir(), "tokenloom-s3-"));
    const sampleDir = join(fixture, "samples", "real-design-system");
    mkdirSync(sampleDir, { recursive: true });
    const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/real-design-system/snapshot.json"), "utf8")) as
      { componentSets: { components: { id: string; props: Record<string, string>; renderPng?: string; root: unknown }[] }[] };
    const components = snapshot.componentSets[0]!.components;
    const [first, second, third] = components;
    const badPathProps = { ...first!.props };
    const missingFileProps = { ...second!.props };
    const duplicatedProps = { ...third!.props };
    first!.renderPng = "render/hand-edited.png";
    second!.id = "9999:9999";
    second!.renderPng = "render/9999-9999.png";
    components.push({ ...third!, id: `${third!.id}-clone` });
    writeFileSync(join(sampleDir, "snapshot.json"), JSON.stringify(snapshot));
    cpSync(resolve(repoRoot, "samples/real-design-system/render"), join(sampleDir, "render"), { recursive: true });

    afterAll(() => rmSync(fixture, { recursive: true, force: true }));

    it("flags a render path that breaks the importer filename rule", () => {
      const references = variantReferences(fixture, { sampleName: "real-design-system" }, [variantSelectorOf(badPathProps)]);
      expect(references[0]?.failure).toBe("FILENAME_RULE_MISMATCH");
    });

    it("flags a rule-compliant path whose file is absent", () => {
      const references = variantReferences(fixture, { sampleName: "real-design-system" }, [variantSelectorOf(missingFileProps)]);
      expect(references[0]?.failure).toBe("REFERENCE_FILE_MISSING");
    });

    it("flags a selector that two components satisfy", () => {
      const references = variantReferences(fixture, { sampleName: "real-design-system" }, [variantSelectorOf(duplicatedProps)]);
      expect(references[0]?.failure).toBe("AMBIGUOUS_SNAPSHOT_COMPONENT");
    });
  });
});

describe("measureS3 wiring (SPEC 9.5)", () => {
  const failIfRendered: RenderPort = () => { throw new Error("render must not be called"); };

  it("yields not-applicable without launching a browser for a sample with no reference", async () => {
    const expected = expectedVariants(repoRoot, { sampleName: "button" });
    const result = await measureS3({
      repoRoot, target: { sampleName: "button" }, expected,
      text: "```css\n.x{}\n```\n```html\n<div data-variant=\"size=md,variant=primary\"></div>\n```",
      render: failIfRendered, readPng: (p) => readFileSync(p),
    });
    expect(result.s3Status).toBe("not-applicable");
  });

  it("reports RENDER_FAILED when the render port throws", async () => {
    const expected = expectedVariants(repoRoot, { sampleName: "real-design-system" });
    const result = await measureS3({
      repoRoot, target: { sampleName: "real-design-system" }, expected,
      text: "```css\n.x{}\n```\n```html\n<div></div>\n```",
      render: () => Promise.reject(new Error("boom")), readPng: (p) => readFileSync(p),
    });
    expect(result.s3Status).toBe("error");
    expect(result.s3Detail.errors).toEqual([{ selector: null, code: "RENDER_FAILED" }]);
  });

  it("measures a generated screenshot matched by selector against its reference", async () => {
    const expected = expectedVariants(repoRoot, { sampleName: "real-design-system" });
    const references = variantReferences(repoRoot, { sampleName: "real-design-system" }, expected.selectors);
    const primary = references.find((r) => r.nodeId === "4185:3779");
    const selector = primary!.selector;
    const referencePng = readFileSync(primary!.renderPng as string);
    const render: RenderPort = () => Promise.resolve([{ variant: selector, png: referencePng }]);
    const result = await measureS3({
      repoRoot, target: { sampleName: "real-design-system" }, expected,
      text: `\`\`\`css\n.x{}\n\`\`\`\n\`\`\`html\n<div data-variant="${selector}"></div>\n\`\`\``,
      render, readPng: (p) => readFileSync(p),
    });
    expect(result.s3Status).toBe("measured");
    expect(result.s3).toBe(0);
    expect(result.s3Detail.worst?.selector).toBe(selector);
  });
});

describe("run verdict with S3 (SPEC 9.5)", () => {
  const thresholds = readThresholds(repoRoot);

  it("keeps a coverage-failing run false even when its rendered variants match", () => {
    const coverage = { scope: "component" as const, expected: 2, actual: 1, matched: 1, variantRecall: 0.5,
      variantPrecision: 1, duplicates: 0, unresolved: 0, missing: ["b"], unexpected: [] };
    const verdict = runVerdict(
      { s1: 1, s2: 1, coverageStatus: "measured", coverage, s3Status: "measured", s3: 0 }, thresholds,
    );
    expect(verdict.s3).toBe("pass");
    expect(verdict.coverage).toBe("fail");
    expect(verdict.overall).toBe(false);
  });

  it("makes overall false when S3 is an error", () => {
    const coverage = { scope: "component" as const, expected: 1, actual: 1, matched: 1, variantRecall: 1,
      variantPrecision: 1, duplicates: 0, unresolved: 0, missing: [], unexpected: [] };
    const verdict = runVerdict(
      { s1: 1, s2: 1, coverageStatus: "measured", coverage, s3Status: "error", s3: null }, thresholds,
    );
    expect(verdict.overall).toBe(false);
  });
});
