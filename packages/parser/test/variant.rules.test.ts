import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot, stableStringify } from "@tokenloom/schema";
import type { DesignContextT } from "@tokenloom/schema";
import { buildDesignContext, selectVariant, variantSelectorOf } from "../src/index";

const root = resolve(import.meta.dirname, "../../..");

function contextOf(sample: string, component: string): DesignContextT {
  const snapshot = Snapshot.parse(JSON.parse(readFileSync(resolve(root, `samples/${sample}/snapshot.json`), "utf8")));
  const result = buildDesignContext(snapshot, { name: component, annotations: true });
  if (!result.ok) throw new Error(`${sample} did not build a design context`);
  return result.context;
}

const chip = (): DesignContextT => contextOf("twenty-variants", "Chip");

function contextWithProps(props: Record<string, string>[]): DesignContextT {
  const context = chip();
  const baseProps = props[0] as Record<string, string>;
  return {
    ...context,
    component: {
      ...context.component,
      props: Object.fromEntries(Object.keys(baseProps).map((key) => [key, props.map((item) => item[key] as string)])),
      base: { ...context.component.base, props: baseProps },
      variants: props.slice(1).map((item, index) => ({
        ...(context.component.variants[index] as DesignContextT["component"]["variants"][number]),
        props: item,
      })),
    },
  };
}

function schemaContext(
  componentProps: Record<string, string>[],
  declaredProps: Record<string, string[]>,
): DesignContextT {
  const snapshot = Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "EDGE", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: [{
      id: "1:1",
      name: "Edge",
      props: declaredProps,
      components: componentProps.map((props, index) => ({
        id: `1:${index + 2}`,
        props,
        root: {
          id: `2:${index + 1}`, name: "Edge", type: "FRAME", visible: true,
          bbox: { x: 0, y: 0, w: 1, h: 1 }, bound: {}, children: [],
        },
      })),
    }],
  });
  const result = buildDesignContext(snapshot, { name: "Edge" });
  if (!result.ok) throw new Error("schema-accepted edge context did not build");
  return result.context;
}

function schemaContextWithProps(baseProps: Record<string, string>): DesignContextT {
  const entries = Object.entries(baseProps);
  const variantProps = Object.fromEntries(entries.map(([key, value]) => [key, `${value}variant`]));
  const declaredProps = Object.fromEntries(entries.map(([key, value]) => [key, [value, `${value}variant`]]));
  return schemaContext([baseProps, variantProps], declaredProps);
}

/** The base of `twenty-variants` is the first declared value of every property. */
const BASE_SELECTOR = "size=xs,state=default";

describe("Variant selector rules from docs/reference/spec.md section 4.12", () => {
  it("A06: an exact selector for the base returns the base and no variants", () => {
    const context = chip();

    const selected = selectVariant(context, BASE_SELECTOR);

    expect(selected.ok && selected.context.component.variants).toEqual([]);
  });

  it("A06: an exact selector for one variant returns that single variant", () => {
    const context = chip();

    const selected = selectVariant(context, "size=md,state=hover");

    expect(selected.ok && selected.context.component.variants.map((v) => v.props))
      .toEqual([{ size: "md", state: "hover" }]);
  });

  it("A06: selection keeps the canonical base, tokensUsed, annotations, and warnings untouched", () => {
    const context = chip();

    const selected = selectVariant(context, "size=lg,state=disabled");

    expect(selected.ok && stableStringify({
      base: selected.context.component.base,
      tokensUsed: selected.context.tokensUsed,
      annotations: selected.context.annotations,
      warnings: selected.context.warnings,
    })).toBe(stableStringify({
      base: context.component.base,
      tokensUsed: context.tokensUsed,
      annotations: context.annotations,
      warnings: context.warnings,
    }));
  });

  it("A06: selecting never mutates the design context it was given", () => {
    const context = chip();
    const before = stableStringify(context);

    selectVariant(context, "size=sm,state=pressed");

    expect(stableStringify(context)).toBe(before);
  });

  it("A06: whitespace around a pair, a key, and a value does not change the selected variant", () => {
    const context = chip();

    const spaced = selectVariant(context, " size = md , state = hover ");

    expect(spaced.ok && stableStringify(spaced.context))
      .toBe(stableStringify((selectVariant(context, "size=md,state=hover") as { context: DesignContextT }).context));
  });

  it("A06: advertised selectors round-trip delimiters, percent signs, multibyte text, and significant spaces", () => {
    const props = [
      { label: "base", "tone,=": "기본" },
      { label: " a,b=c% ", "tone,=": "강조=100%,한" },
      { label: "a%2Cb", "tone,=": "literal" },
    ];
    const context = contextWithProps(props);
    const selectors = props.map(variantSelectorOf);

    const selected = selectors.map((selector) => selectVariant(context, selector));

    expect({
      selectors,
      props: selected.map((result) => result.ok
        ? result.context.component.variants[0]?.props ?? result.context.component.base.props
        : result.failure),
    }).toEqual({
      selectors: [
        "label=base,tone%2C%3D=%EA%B8%B0%EB%B3%B8",
        "label=%20a%2Cb%3Dc%25%20,tone%2C%3D=%EA%B0%95%EC%A1%B0%3D100%25%2C%ED%95%9C",
        "label=a%252Cb,tone%2C%3D=literal",
      ],
      props,
    });
  });

  it("A06: schema-accepted empty strings and UTF-16 code units round-trip exactly", () => {
    const props = {
      "": "",
      emptyValue: "",
      high: "\uD800",
      korean: "한",
      literalEscape: "%uD800",
      low: "\uDC00",
      ordinary: "md",
      pair: "😀",
      separators: " a,b=c% ",
      "\uD800": "high-key",
      "\uDC00": "low-key",
    };
    const context = schemaContextWithProps(props);

    const selector = variantSelectorOf(context.component.base.props);
    const selected = selectVariant(context, selector);

    expect({
      selector,
      selected: selected.ok && selected.context.component.base.props,
      variants: selected.ok && selected.context.component.variants,
    }).toEqual({
        selector: [
          "=,emptyValue=,high=%uD800,korean=%ED%95%9C,literalEscape=%25uD800",
          "low=%uDC00,ordinary=md,pair=%F0%9F%98%80,separators=%20a%2Cb%3Dc%25%20",
          "%uD800=high-key,%uDC00=low-key",
        ].join(","),
        selected: props,
        variants: [],
      });
  });

  it("A06: an empty-property base advertises and accepts the standalone selector", () => {
    const context = schemaContext([{}, { kind: "variant" }], { kind: ["base", "variant"] });
    const selector = variantSelectorOf(context.component.base.props);

    const selected = selectVariant(context, selector);

    expect({ selector, variants: selected.ok && selected.context.component.variants })
      .toEqual({ selector: "{}", variants: [] });
  });

  it("A06: an empty-property variant uses the ordinary single-variant result", () => {
    const context = schemaContext([{ kind: "base" }, {}], { kind: ["base", "variant"] });
    const variant = context.component.variants[0];
    if (variant === undefined) throw new Error("schema-accepted empty variant was omitted");
    const selector = variantSelectorOf(variant.props);

    const selected = selectVariant(context, selector);

    expect(selected.ok && selected.context.component.variants.map((variant) => variant.props)).toEqual([{}]);
  });

  it("A06: the empty-map selector is not a wildcard for nonempty candidates", () => {
    const selected = selectVariant(chip(), "{}");

    expect(!selected.ok && selected.failure.code).toBe("VARIANT_NOT_FOUND");
  });

  it("A06: multiple empty-property candidates remain ambiguous", () => {
    const selected = selectVariant(schemaContext([{}, {}], {}), "{}");

    expect(!selected.ok && selected.failure).toEqual({
      code: "VARIANT_AMBIGUOUS",
      detail: '"{}" matches 2 components',
      available: ["{}", "{}"],
    });
  });

  it("A06: an empty key assignment remains distinct from an empty selector", () => {
    const context = schemaContextWithProps({ "": "x" });

    const assignment = selectVariant(context, "=x");
    const empty = selectVariant(context, "");

    expect({ assignment: assignment.ok, empty: !empty.ok && empty.failure.code })
      .toEqual({ assignment: true, empty: "VARIANT_SELECTOR_INVALID" });
  });

  it("A06: encoded braces remain ordinary key and value data", () => {
    const context = schemaContextWithProps({ "{}": "{}" });
    const selector = variantSelectorOf(context.component.base.props);

    const selected = selectVariant(context, selector);

    expect({ selector, selected: selected.ok && selected.context.component.base.props })
      .toEqual({ selector: "%7B%7D=%7B%7D", selected: { "{}": "{}" } });
  });

  it.each(["label=%", "label=%2", "label=%GG", "label=%E0%A4%A", "label=%uD80", "label=%uZZZZ", "label=%u0061"])(
    "A06: malformed percent encoding in %s returns a structured invalid selector",
    (selector) => {
      const selected = selectVariant(contextWithProps([{ label: "base" }]), selector);

      expect(!selected.ok && selected.failure.code).toBe("VARIANT_SELECTOR_INVALID");
    },
  );

  it("A06: an unknown property key is rejected with the known keys", () => {
    const context = chip();

    const selected = selectVariant(context, "colour=red");

    expect(!selected.ok && selected.failure).toEqual({
      code: "VARIANT_SELECTOR_INVALID",
      detail: "unknown variant key colour",
      keys: ["size", "state"],
    });
  });

  it("A06: candidate-owned keys remain selectable when declarations omit them", () => {
    const context = schemaContext([
      { size: "sm", platform: "ios" },
      { size: "sm", platform: "android" },
    ], { size: ["sm"] });
    const variant = context.component.variants[0];
    if (variant === undefined) throw new Error("schema-accepted candidate was omitted");
    const selector = variantSelectorOf(variant.props);

    const selected = selectVariant(context, selector);

    expect({ selector, variants: selected.ok && selected.context.component.variants.map((item) => item.props) })
      .toEqual({ selector: "platform=android,size=sm", variants: [{ platform: "android", size: "sm" }] });
  });

  it("A06: structured invalid-key guidance includes declared and candidate-owned keys", () => {
    const context = schemaContext([
      { size: "sm", platform: "ios" },
      { size: "sm", platform: "android" },
    ], { size: ["sm"] });

    const selected = selectVariant(context, "colour=red");

    expect(!selected.ok && selected.failure).toEqual({
      code: "VARIANT_SELECTOR_INVALID",
      detail: "unknown variant key colour",
      keys: ["platform", "size"],
    });
  });

  it("A06: an inherited object property is rejected when it is not a declared variant key", () => {
    const selected = selectVariant(chip(), "constructor=x");

    expect(!selected.ok && selected.failure).toEqual({
      code: "VARIANT_SELECTOR_INVALID",
      detail: "unknown variant key constructor",
      keys: ["size", "state"],
    });
  });

  it("A06: constructor selects normally when it is an own variant key", () => {
    const context = contextWithProps([{ constructor: "base" }, { constructor: "raised" }]);

    const selected = selectVariant(context, "constructor=raised");

    expect(selected.ok && selected.context.component.variants.map((variant) => variant.props))
      .toEqual([{ constructor: "raised" }]);
  });

  it("A06: a token without an equals sign is rejected as a malformed selector", () => {
    const context = chip();

    const selected = selectVariant(context, "size");

    expect(!selected.ok && selected.failure.code).toBe("VARIANT_SELECTOR_INVALID");
  });

  it("A06: an unknown value returns VARIANT_NOT_FOUND listing every selectable variant", () => {
    const context = chip();

    const selected = selectVariant(context, "size=does-not-exist");

    expect(!selected.ok && selected.failure.code === "VARIANT_NOT_FOUND" && selected.failure.available)
      .toEqual([BASE_SELECTOR, ...context.component.variants.map((v) => variantSelectorOf(v.props))]);
  });

  it("A06: a partial selector matching several components returns VARIANT_AMBIGUOUS with those selectors", () => {
    const context = chip();

    const selected = selectVariant(context, "size=md");

    expect(!selected.ok && selected.failure.code === "VARIANT_AMBIGUOUS" && selected.failure.available).toEqual([
      "size=md,state=default", "size=md,state=hover", "size=md,state=pressed",
      "size=md,state=selected", "size=md,state=disabled",
    ]);
  });

  it("A06: a component set with one property still selects its base by that property alone", () => {
    const context = contextOf("button", "Button");

    const selected = selectVariant(context, "variant=secondary,size=md");

    expect(selected.ok && selected.context.component.variants.map((v) => v.props))
      .toEqual([{ variant: "secondary", size: "md" }]);
  });
});
