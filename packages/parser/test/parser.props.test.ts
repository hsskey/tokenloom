import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { RawNodeT, SnapshotT } from "@tokenloom/schema";
import { DesignContext, Snapshot, stableStringify } from "@tokenloom/schema";
import {
  DISCOVERY_LIMIT, applyDelta, buildDesignContext, compactNode, discoverComponentSets, makeCompactionState,
  projectAgentContext, selectVariant, stripIds, variantSelectorOf,
} from "../src/index";

const RUNS = { numRuns: 200 } as const;

function recordPropertyExecution(id: string, runs: number): void {
  const path = process.env.TOKENLOOM_PROPERTY_EVIDENCE;
  if (path !== undefined) appendFileSync(path, `${JSON.stringify({ id, runs })}\n`);
}

const KNOWN_TYPES = ["FRAME", "COMPONENT", "GROUP", "RECTANGLE", "TEXT", "INSTANCE", "VECTOR"];
const MAX_DEPTH = 6;
const MAX_CHILDREN = 5;

const colorArb = fc.record({
  r: fc.double({ min: 0, max: 1, noNaN: true }),
  g: fc.double({ min: 0, max: 1, noNaN: true }),
  b: fc.double({ min: 0, max: 1, noNaN: true }),
  a: fc.double({ min: 0, max: 1, noNaN: true }),
});

const pad = (): fc.Arbitrary<number> => fc.integer({ min: 0, max: 32 });

const typeArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...KNOWN_TYPES) },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 8 }) },
);

/** Generates depth at most 6, up to 5 children, and known or arbitrary node types. */
function nodeArb(depth: number, boundFill?: string): fc.Arbitrary<RawNodeT> {
  // Bias toward small trees so the required property runs stay within the verification time budget.
  const children = depth >= MAX_DEPTH
    ? fc.constant([])
    : fc.array(nodeArb(depth + 1, boundFill), { maxLength: MAX_CHILDREN, size: "xsmall" });
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `n${s}`),
    name: fc.string({ minLength: 1, maxLength: 10 }),
    type: typeArb,
    visible: fc.boolean(),
    bbox: fc.record({
      x: fc.integer({ min: 0, max: 1000 }), y: fc.integer({ min: 0, max: 1000 }),
      w: fc.integer({ min: 1, max: 400 }), h: fc.integer({ min: 1, max: 400 }),
    }),
    layout: fc.option(fc.record({
      mode: fc.constantFrom("HORIZONTAL" as const, "VERTICAL" as const, "NONE" as const),
      gap: fc.integer({ min: 0, max: 32 }),
      padding: fc.tuple(pad(), pad(), pad(), pad()),
      sizingH: fc.constantFrom("HUG" as const, "FILL" as const, "FIXED" as const),
      sizingV: fc.constantFrom("HUG" as const, "FILL" as const, "FIXED" as const),
    }), { nil: undefined }),
    fills: fc.option(fc.array(fc.record({ type: fc.constant("SOLID" as const), color: colorArb }), { minLength: 1, maxLength: 1 }), { nil: undefined }),
    radius: fc.option(fc.integer({ min: 0, max: 24 }), { nil: undefined }),
    text: fc.option(fc.record({
      characters: fc.string({ maxLength: 20 }), fontFamily: fc.constant("Inter"),
      fontSize: fc.integer({ min: 8, max: 40 }), fontWeight: fc.constantFrom(400, 600, 700),
      lineHeight: fc.integer({ min: 8, max: 48 }),
    }), { nil: undefined }),
    bound: fc.constant(boundFill === undefined ? {} : { fill: boundFill }),
    children,
  }) as unknown as fc.Arbitrary<RawNodeT>;
}

const VARIABLES = [
  { id: "v1", name: "color/brand/500", collectionId: "c1", type: "COLOR" as const, valuesByMode: { m0: { r: 0.1, g: 0.4, b: 0.9, a: 1 } } },
];

function snapshotOf(roots: RawNodeT[], props: Record<string, string>[]): SnapshotT {
  return Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "F", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [{ id: "c1", name: "P", modes: [{ id: "m0", name: "Value" }], defaultModeId: "m0" }],
    variables: VARIABLES,
    textStyles: [],
    componentSets: [{
      id: "90:1", name: "Gen",
      props: { variant: props.map((p) => p.variant ?? "a") },
      components: roots.map((root, i) => ({ id: `c${i}`, props: props[i] ?? { variant: "a" }, root })),
    }],
    annotations: [],
  });
}

/** Clone with zero to five changed leaf values and identical structure. */
function mutateLeaves(node: RawNodeT, budget: { left: number }): RawNodeT {
  const clone = JSON.parse(stableStringify(node)) as RawNodeT;
  const walk = (n: RawNodeT): void => {
    if (budget.left > 0 && n.fills?.[0]?.color !== undefined) {
      n.fills[0].color = { r: 0.2, g: 0.3, b: 0.4, a: 1 };
      budget.left -= 1;
    }
    for (const child of n.children) walk(child);
  };
  walk(clone);
  return clone;
}

/** Component sets that only need names and component counts, which is all discovery reads. */
function discoverySnapshotOf(specs: { id: string; name: string; components: number }[]): SnapshotT {
  return Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "F", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: specs.map((spec, index) => ({
      id: spec.id,
      name: spec.name,
      props: { variant: ["a"] },
      components: Array.from({ length: spec.components }, (_, i) => ({
        id: `s${index}-${i}`,
        props: { variant: "a" },
        root: { id: `s${index}-${i}`, name: "n", type: "FRAME", visible: true, bbox: { x: 0, y: 0, w: 8, h: 8 }, bound: {}, children: [] },
      })),
    })),
  });
}

describe("properties from docs/reference/verification.md section 6", () => {
  it("P01: arbitrary RawNode trees satisfy the DesignContext schema", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), (root) => {
        runs += 1;
        const result = buildDesignContext(snapshotOf([{ ...root, visible: true }], [{ variant: "a" }]), { name: "Gen" });
        if (!result.ok) return result.error.kind === "empty";
        return DesignContext.safeParse(result.context).success;
      }),
      RUNS,
    );
    recordPropertyExecution("P01", runs);
  });

  it("P02: applyDelta(base.root, delta) deeply equals the compact variant tree", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), fc.integer({ min: 0, max: 5 }), (root, changes) => {
        runs += 1;
        const base = { ...root, visible: true };
        const variant = mutateLeaves(base, { left: changes });
        const snapshot = snapshotOf([base, variant], [{ variant: "a" }, { variant: "b" }]);
        const result = buildDesignContext(snapshot, { name: "Gen" });
        if (!result.ok) return true;
        const first = result.context.component.variants[0];
        if (first?.delta === undefined) return true;
        const applied = applyDelta(result.context.component.base.root, first.delta);
        const state = makeCompactionState(snapshot, "compact");
        const tree = compactNode(state, variant);
        if (tree === null) return true;
        return stableStringify(stripIds(applied)) === stableStringify(stripIds(tree));
      }),
      RUNS,
    );
    recordPropertyExecution("P02", runs);
  });

  it("P03: compact output is no larger than full output", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), (root) => {
        runs += 1;
        const snapshot = snapshotOf([{ ...root, visible: true }], [{ variant: "a" }]);
        const compact = buildDesignContext(snapshot, { name: "Gen", level: "compact" });
        const full = buildDesignContext(snapshot, { name: "Gen", level: "full" });
        if (!compact.ok || !full.ok) return true;
        return stableStringify(compact.context).length <= stableStringify(full.context).length;
      }),
      RUNS,
    );
    recordPropertyExecution("P03", runs);
  });

  it("P04: bound.fill prevents raw: values in style.bg and style.fg", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0, "v1"), (root) => {
        runs += 1;
        const result = buildDesignContext(snapshotOf([{ ...root, visible: true }], [{ variant: "a" }]), { name: "Gen" });
        if (!result.ok) return true;
        const rawValues: string[] = [];
        const walk = (n: { style: Record<string, string>; children: unknown[] }): void => {
          for (const key of ["bg", "fg"]) {
            const value = n.style[key];
            if (value !== undefined && value.startsWith("raw:")) rawValues.push(value);
          }
          for (const child of n.children) walk(child as never);
        };
        walk(result.context.component.base.root as never);
        return rawValues.length === 0;
      }),
      RUNS,
    );
    recordPropertyExecution("P04", runs);
  });

  it("P05: key order and order-independent arrays do not change output bytes", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), (root) => {
        runs += 1;
        const snapshot = snapshotOf([{ ...root, visible: true }], [{ variant: "a" }]);
        const first = buildDesignContext(snapshot, { name: "Gen", annotations: true });
        const shuffled = Snapshot.parse(JSON.parse(stableStringify({
          ...snapshot,
          variables: [...snapshot.variables].reverse(),
          textStyles: [...snapshot.textStyles].reverse(),
          annotations: [...snapshot.annotations].reverse(),
        })));
        const second = buildDesignContext(shuffled, { name: "Gen", annotations: true });
        if (!first.ok || !second.ok) return first.ok === second.ok;
        return stableStringify(first.context) === stableStringify(second.context);
      }),
      RUNS,
    );
    recordPropertyExecution("P05", runs);
  });

  it("P06: projecting the Agent view never changes the canonical context and always yields the same bytes", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), (root) => {
        runs += 1;
        const result = buildDesignContext(snapshotOf([{ ...root, visible: true }], [{ variant: "a" }]), { name: "Gen", annotations: true });
        if (!result.ok) return true;
        const before = stableStringify(result.context);
        const first = stableStringify(projectAgentContext(result.context));
        const second = stableStringify(projectAgentContext(result.context));
        return stableStringify(result.context) === before && first === second;
      }),
      RUNS,
    );
    recordPropertyExecution("P06", runs);
  });

  it("P07: the only difference between the Agent view and canonical is the top-level version and source", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), (root) => {
        runs += 1;
        const result = buildDesignContext(snapshotOf([{ ...root, visible: true }], [{ variant: "a" }]), { name: "Gen", annotations: true });
        if (!result.ok) return true;
        const context = result.context;
        const restored = { version: context.version, source: context.source, ...projectAgentContext(context) };
        return stableStringify(restored) === stableStringify(context);
      }),
      RUNS,
    );
    recordPropertyExecution("P07", runs);
  });

  it("P01: unknown node types pass through with the unknown role", () => {
    const result = buildDesignContext(
      snapshotOf([{
        id: "n1", name: "X", type: "SLICE", visible: true,
        bbox: { x: 0, y: 0, w: 10, h: 10 }, bound: {}, children: [],
      } as RawNodeT], [{ variant: "a" }]),
      { name: "Gen" },
    );
    expect(result.ok && result.context.component.base.root.role).toBe("unknown");
    expect(result.ok && result.context.warnings.map((w) => w.code)).toEqual(["UNKNOWN_NODE_TYPE"]);
  });

  it("P08: selecting one variant restores the same tree as the full canonical context", () => {
    let runs = 0;
    fc.assert(
      fc.property(nodeArb(0), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 2 }), (root, changes, pick) => {
        runs += 1;
        const base = { ...root, visible: true };
        const snapshot = snapshotOf(
          [base, mutateLeaves(base, { left: changes }), mutateLeaves(base, { left: changes })],
          [{ variant: "a" }, { variant: "b" }, { variant: "c" }],
        );
        const full = buildDesignContext(snapshot, { name: "Gen" });
        if (!full.ok) return true;
        const variants = full.context.component.variants;
        const wanted = variants[pick % Math.max(1, variants.length)];
        if (wanted === undefined) return true;
        const before = stableStringify(full.context);

        const selected = selectVariant(full.context, variantSelectorOf(wanted.props));
        if (!selected.ok) return false;
        const only = selected.context.component.variants[0];
        if (only === undefined || selected.context.component.variants.length !== 1) return false;
        const sliced = only.delta === undefined
          ? only.root
          : applyDelta(selected.context.component.base.root, only.delta);
        const canonical = wanted.delta === undefined ? wanted.root : applyDelta(full.context.component.base.root, wanted.delta);
        return stableStringify(full.context) === before && stableStringify(sliced) === stableStringify(canonical);
      }),
      RUNS,
    );
    recordPropertyExecution("P08", runs);
  });

  it("P09: discovery stays bounded and sorted whatever order the snapshot declares", () => {
    let runs = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ name: fc.constantFrom("A", "B", "C", "Card", "Chip", "Button"), components: fc.integer({ min: 0, max: 4 }) }),
          { minLength: 1, maxLength: 26 },
        ),
        (drawn) => {
          runs += 1;
          // The id travels with its set so reversing changes declaration order only, not content.
          const specs = drawn.map((spec, index) => ({ ...spec, id: `${200 + index}:1` }));
          const forward = discoverComponentSets(discoverySnapshotOf(specs));
          const reversed = discoverComponentSets(discoverySnapshotOf([...specs].reverse()));
          const names = forward.components.map((c) => c.name);
          const sorted = names.every((name, i) => i === 0 || (names[i - 1] as string) <= name);
          return sorted
            && forward.returned <= DISCOVERY_LIMIT
            && forward.count >= forward.returned
            && forward.returned === forward.components.length
            && forward.truncated === (forward.count > forward.returned)
            && stableStringify(forward) === stableStringify(reversed);
        },
      ),
      RUNS,
    );
    recordPropertyExecution("P09", runs);
  });
});
