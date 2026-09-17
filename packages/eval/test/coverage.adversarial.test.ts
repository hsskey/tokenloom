import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreCoverage } from "../src/coverage";
import { expectedVariants } from "../src/variant-reference";
import { extractBlocks, scoreS1, scoreS2 } from "../src/score";

const repoRoot = resolve(import.meta.dirname, "../../..");
const fake = (name: string): string => readFileSync(resolve(repoRoot, "packages/eval/samples/fake-responses", `${name}.md`), "utf8");
const tokensCss = (sample: string): string => readFileSync(resolve(repoRoot, "samples", sample, "reference/css/tokens.css"), "utf8");

function output(css: string, html: string): string {
  return "```css\n" + css + "\n```\n\n```html\n" + html + "\n```\n";
}

/** Coverage over the twenty-variant Chip and the two-variant Button, scored against committed design context. */
describe("adversarial coverage cases (SPEC 9.5)", () => {
  const twentyCss = extractBlocks(fake("twenty-variants")).css ?? "";
  const twentyExpected = expectedVariants(repoRoot, { sampleName: "twenty-variants" });
  const buttonExpected = expectedVariants(repoRoot, { sampleName: "button" });

  it("A16 fails coverage for a one-of-twenty response while S1 and S2 pass", () => {
    const oneOfTwenty = output(twentyCss, '<div data-variant="size=xs,state=default"></div>');
    const coverage = scoreCoverage(oneOfTwenty, twentyExpected).coverage;

    expect(scoreS1(oneOfTwenty, tokensCss("twenty-variants"))).toBe(1);
    expect(scoreS2(oneOfTwenty)).toBe(1);
    expect(coverage?.variantRecall).toBe(0.05);
    expect(coverage?.matched).toBe(1);
    expect(coverage?.missing).toHaveLength(19);
  });

  it("A17 counts two spellings of one variant as a duplicate, not two matches", () => {
    const html = '<div data-variant="variant=primary,size=md"></div><div data-variant="size=md,variant=primary"></div>';
    const coverage = scoreCoverage(output(".x{}", html), buttonExpected).coverage;

    expect(coverage?.matched).toBe(1);
    expect(coverage?.duplicates).toBe(1);
    expect(coverage?.missing).toEqual(["size=md,variant=secondary"]);
  });

  it("A18 lowers precision for a nonexistent, an ambiguous, and a malformed marker with their codes", () => {
    const html = '<div data-variant="variant=ghost,size=md"></div><div data-variant="size=md"></div><div data-variant="tone=loud"></div>';
    const coverage = scoreCoverage(output(".x{}", html), buttonExpected).coverage;

    expect(coverage?.matched).toBe(0);
    expect(coverage?.unresolved).toBe(3);
    expect(coverage?.variantPrecision).toBe(0);
    expect(coverage?.unexpected).toEqual([
      "VARIANT_AMBIGUOUS:size=md", "VARIANT_NOT_FOUND:variant=ghost,size=md", "VARIANT_SELECTOR_INVALID:tone=loud",
    ]);
  });

  it("A19 resolves reordered keys and surrounding whitespace to the canonical selector", () => {
    const html = '<div data-variant="variant=primary,size=md"></div><div data-variant=" size = md , variant = secondary "></div>';
    const coverage = scoreCoverage(output(".x{}", html), buttonExpected).coverage;

    expect(coverage?.matched).toBe(2);
    expect(coverage?.variantRecall).toBe(1);
    expect(coverage?.duplicates).toBe(0);
    expect(coverage?.missing).toEqual([]);
  });

  it("A20 ignores a marker in the css block or outside both fenced blocks", () => {
    const stray = 'note data-variant="size=md,variant=secondary" note';
    const html = '<div data-variant="variant=primary,size=md"></div><div data-variant="variant=secondary,size=md"></div>';
    const coverage = scoreCoverage(`${stray}\n${output('.x[data-variant="size=md,variant=secondary"]{}', html)}\n${stray}`, buttonExpected).coverage;

    expect(coverage?.matched).toBe(2);
    expect(coverage?.actual).toBe(2);
    expect(coverage?.unexpected).toEqual([]);
  });

  it("A21 restricts a variant subset to one selector and flags another real variant as unexpected", () => {
    const subset = expectedVariants(repoRoot, { sampleName: "twenty-variants", variant: "size=md,state=default" });
    const html = '<div data-variant="size=md,state=default"></div><div data-variant="size=lg,state=hover"></div>';
    const coverage = scoreCoverage(output(".x{}", html), subset).coverage;

    expect(subset.scope).toBe("variant");
    expect(subset.selectors).toEqual(["size=md,state=default"]);
    expect(coverage?.matched).toBe(1);
    expect(coverage?.unexpected).toEqual(["size=lg,state=hover"]);
  });

  it("A22 derives an expected set from design context, identical across input representations", () => {
    expect(buttonExpected.selectors).toEqual(["size=md,variant=primary", "size=md,variant=secondary"]);
    expect(expectedVariants(repoRoot, { sampleName: "button" }).selectors).toEqual(buttonExpected.selectors);
  });

  it("A23 passes coverage for a complete response with no duplicates or unexpected variants", () => {
    const coverage = scoreCoverage(fake("twenty-variants"), twentyExpected).coverage;

    expect(coverage?.variantRecall).toBe(1);
    expect(coverage?.variantPrecision).toBe(1);
    expect(coverage?.duplicates).toBe(0);
    expect(coverage?.unexpected).toEqual([]);
  });

  it("A24 records NO_HTML_BLOCK without an html block and NO_OUTPUT for empty output", () => {
    expect(scoreCoverage("```css\n.x{}\n```", buttonExpected)).toEqual({
      coverageStatus: "error", coverage: null, coverageError: "NO_HTML_BLOCK",
    });
    expect(scoreCoverage("", buttonExpected)).toEqual({
      coverageStatus: "error", coverage: null, coverageError: "NO_OUTPUT",
    });
  });
});
