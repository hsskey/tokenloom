import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignNodeT, RawNodeT, SnapshotT } from "@tokenloom/schema";
import { Snapshot, visiblePaintsWithBound } from "@tokenloom/schema";
import { applyDelta, buildDesignContext, classify, compactNode, deltaBetween, makeCompactionState, roleOf, selectComponentSet, stripIds } from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");
const button = (): SnapshotT =>
  Snapshot.parse(JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8")));
const annotatedTheme = (): SnapshotT =>
  Snapshot.parse(JSON.parse(readFileSync(resolve(repoRoot, "samples/real-annotated-theme/snapshot.json"), "utf8")));

function node(over: Partial<RawNodeT> & { id: string; type: string }): RawNodeT {
  return {
    name: over.name ?? "Node",
    visible: over.visible ?? true,
    bbox: over.bbox ?? { x: 0, y: 0, w: 100, h: 40 },
    bound: over.bound ?? {},
    children: over.children ?? [],
    ...over,
  } as RawNodeT;
}

function stateOf(over: Partial<SnapshotT> = {}) {
  const snapshot = Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "F", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], componentSets: [], annotations: [],
    ...over,
  });
  return makeCompactionState(snapshot, "compact");
}

const V_SPACE = { id: "v5", name: "space/sm", collectionId: "c", type: "FLOAT" as const, valuesByMode: { m: 8 } };
const V_COLOR = { id: "v8", name: "color/button/primary/bg", collectionId: "c", type: "COLOR" as const, valuesByMode: { m: { r: 0, g: 0, b: 0, a: 1 } } };
const V_BORDER_W = { id: "v9", name: "border/width/sm", collectionId: "c", type: "FLOAT" as const, valuesByMode: { m: 1 } };

describe("RawNode to DesignNode rules (docs/reference/spec.md section 4.4)", () => {
  it("R01: visible false removes the entire subtree", () => {
    const state = stateOf();
    expect(compactNode(state, node({ id: "1", type: "FRAME", visible: false, children: [node({ id: "2", type: "TEXT" })] }))).toBe(null);
    expect(state.warnings).toEqual([]);
  });

  it("R02: maps TEXT to text and INSTANCE to instance without expanding children", () => {
    const state = stateOf();
    expect(roleOf(state, node({ id: "1", type: "TEXT" }))).toBe("text");
    const inst = compactNode(state, node({ id: "2", type: "INSTANCE", mainComponentId: "m1", children: [node({ id: "3", type: "TEXT" })] }));
    expect(inst?.role).toBe("instance");
    expect(inst?.children).toEqual([]);
    expect(inst?.instanceOf).toBe("m1");
  });

  it("R02: maps IMAGE fills to image, VECTOR at most 48 to icon, and FRAME to container", () => {
    const state = stateOf();
    expect(roleOf(state, node({ id: "1", type: "RECTANGLE", fills: [{ type: "IMAGE" }] }))).toBe("image");
    expect(roleOf(state, node({ id: "2", type: "VECTOR", bbox: { x: 0, y: 0, w: 24, h: 24 } }))).toBe("icon");
    expect(roleOf(state, node({ id: "3", type: "FRAME" }))).toBe("container");
  });

  it("R02: preserves unknown-type subtrees with role unknown and UNKNOWN_NODE_TYPE", () => {
    const state = stateOf();
    const out = compactNode(state, node({ id: "1", type: "WIDGET", children: [node({ id: "2", type: "TEXT", text: { characters: "x", fontFamily: "Inter", fontSize: 12, fontWeight: 400, lineHeight: 16 } })] }));
    expect(out?.role).toBe("unknown");
    expect(out?.children).toHaveLength(1);
    expect(state.warnings.filter((w) => w.code === "UNKNOWN_NODE_TYPE")).toEqual([{ code: "UNKNOWN_NODE_TYPE", nodeId: "1", detail: "WIDGET" }]);
  });

  it("R03: maps HORIZONTAL to row, VERTICAL to col, and missing layout to none", () => {
    const state = stateOf();
    expect(compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL" } }))?.layout.dir).toBe("row");
    expect(compactNode(state, node({ id: "2", type: "FRAME", layout: { mode: "VERTICAL" } }))?.layout.dir).toBe("col");
    expect(compactNode(state, node({ id: "3", type: "FRAME" }))?.layout.dir).toBe("none");
  });

  it("R04: reports one ABSOLUTE_POSITION when dir is none and at least two children exist", () => {
    const state = stateOf();
    const children = [node({ id: "a", type: "FRAME" }), node({ id: "b", type: "FRAME" }), node({ id: "c", type: "FRAME" })];
    compactNode(state, node({ id: "1", type: "FRAME", children }));
    expect(state.warnings).toEqual([{ code: "ABSOLUTE_POSITION", nodeId: "1", detail: "3 children without auto layout" }]);
  });

  it("R05: uses a TokenRef for bound gaps and reports positive unbound gaps", () => {
    const bound = stateOf({ variables: [V_SPACE] });
    expect(compactNode(bound, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v5" } }))?.layout.gap).toBe("space.sm");
    const unbound = stateOf();
    expect(compactNode(unbound, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 } }))?.layout.gap).toBe(8);
    expect(unbound.warnings).toEqual([{ code: "UNBOUND_DIMENSION", nodeId: "1", detail: "8" }]);
    const zero = stateOf();
    expect(compactNode(zero, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 0 } }))?.layout.gap).toBe(undefined);
  });

  it("R06: applies R05 to each padding side and omits all-zero padding", () => {
    const state = stateOf({ variables: [V_SPACE] });
    const padded = compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", padding: [8, 16, 8, 16] }, bound: { padding: ["v5", undefined, "v5", undefined] } }));
    expect(padded?.layout.pad).toEqual(["space.sm", 16, "space.sm", 16]);
    const zero = stateOf();
    expect(compactNode(zero, node({ id: "2", type: "FRAME", layout: { mode: "HORIZONTAL", padding: [0, 0, 0, 0] } }))?.layout.pad).toBe(undefined);
  });

  it("R07: maps MIN, CENTER, MAX, and SPACE_BETWEEN to alignment values", () => {
    const state = stateOf();
    const out = compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", primaryAlign: "SPACE_BETWEEN", counterAlign: "MAX" } }));
    expect(out?.layout.align).toBe("between");
    expect(out?.layout.crossAlign).toBe("end");
  });

  it("R08: maps FIXED to fixed with size and defaults missing sizing to hug", () => {
    const state = stateOf();
    const fixed = compactNode(state, node({ id: "1", type: "FRAME", bbox: { x: 0, y: 0, w: 120, h: 44 }, layout: { mode: "HORIZONTAL", sizingH: "FIXED", sizingV: "FILL" } }));
    expect(fixed?.layout.sizing).toEqual({ w: "fixed", h: "fill" });
    expect(fixed?.layout.size).toEqual({ w: 120 });
    expect(compactNode(state, node({ id: "2", type: "FRAME" }))?.layout.sizing).toEqual({ w: "hug", h: "hug" });
  });

  it("R09: emits raw hex with UNBOUND_COLOR for unbound SOLID fills and uses fg for TEXT", () => {
    const state = stateOf();
    const out = compactNode(state, node({ id: "1", type: "FRAME", fills: [{ type: "SOLID", color: { r: 0.102, g: 0.451, b: 0.91, a: 1 } }] }));
    expect(out?.style).toEqual({ bg: "raw:#1a73e8" });
    expect(state.warnings).toEqual([{ code: "UNBOUND_COLOR", nodeId: "1", detail: "#1a73e8" }]);
    const bound = stateOf({ variables: [V_COLOR] });
    const text = compactNode(bound, node({ id: "2", type: "TEXT", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }], bound: { fill: "v8" }, text: { characters: "x", fontFamily: "Inter", fontSize: 12, fontWeight: 400, lineHeight: 16 } }));
    expect(text?.style).toEqual({ fg: "color.button.primary.bg" });
  });

  it("R09: uses the first visible fill as the background when the first input fill is hidden", () => {
    // Hidden paints must be removed before the first remaining fill determines the visible color.
    const paints = [
      { type: "SOLID" as const, color: { r: 0, g: 0, b: 0, a: 1 }, visible: false },
      { type: "SOLID" as const, color: { r: 0.102, g: 0.451, b: 0.91, a: 1 } },
    ];
    const state = stateOf();
    const out = compactNode(state, node({ id: "1", type: "FRAME", fills: visiblePaintsWithBound(paints, []).map((p) => p.paint) }));
    expect(out?.style).toEqual({ bg: "raw:#1a73e8" });
    expect(state.warnings).toEqual([{ code: "UNBOUND_COLOR", nodeId: "1", detail: "#1a73e8" }]);
  });

  it("R09: excludes variables bound only to hidden fills from background tokens", () => {
    // Paints and bindings stay paired, so removing a hidden paint also removes its binding.
    const paints = [
      { type: "SOLID" as const, color: { r: 0, g: 0, b: 0, a: 1 }, visible: false },
      { type: "SOLID" as const, color: { r: 0.102, g: 0.451, b: 0.91, a: 1 } },
    ];
    const pairs = visiblePaintsWithBound(paints, ["v8", undefined]);
    const state = stateOf({ variables: [V_COLOR] });
    const out = compactNode(state, node({
      id: "1", type: "FRAME",
      fills: pairs.map((p) => p.paint),
      bound: { fill: pairs[0]?.bound },
    }));
    expect(out?.style).toEqual({ bg: "raw:#1a73e8" });
    expect(out?.style.bg).not.toBe("color.button.primary.bg");
    expect(state.warnings).toEqual([{ code: "UNBOUND_COLOR", nodeId: "1", detail: "#1a73e8" }]);
  });

  it("R10: excludes variables bound only to hidden strokes from border tokens", () => {
    const strokes = [
      { color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, visible: false },
      { color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2 },
    ];
    const pairs = visiblePaintsWithBound(strokes, ["v8", undefined]);
    const state = stateOf({ variables: [V_COLOR] });
    const out = compactNode(state, node({
      id: "1", type: "FRAME",
      strokes: pairs.map((p) => p.paint),
      bound: { stroke: pairs[0]?.bound },
    }));
    expect(out?.style.border).toBe("raw:#ff0000");
    expect(state.warnings).toEqual([{ code: "UNBOUND_COLOR", nodeId: "1", detail: "#ff0000" }]);
  });

  it("R10: maps strokes[0] to style.border and style.borderWidth", () => {
    const state = stateOf();
    const out = compactNode(state, node({ id: "1", type: "FRAME", strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2 }] }));
    expect(out?.style.border).toBe("raw:#000000");
    expect(out?.style.borderWidth).toBe("raw:2px");
  });

  it("R10: uses a TokenRef for bound stroke weight and raw pixels without a warning otherwise", () => {
    const strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 1 }];
    const bound = stateOf({ variables: [V_COLOR, V_BORDER_W] });
    const withRef = compactNode(bound, node({ id: "1", type: "FRAME", strokes, bound: { stroke: "v8", strokeWeight: "v9" } }));
    expect(withRef?.style.borderWidth).toBe("border.width.sm");
    expect(bound.warnings).toEqual([]);
    // Both contexts use the same variables; only the node's bound.strokeWeight differs.
    const unbound = stateOf({ variables: [V_COLOR, V_BORDER_W] });
    const withRaw = compactNode(unbound, node({ id: "2", type: "FRAME", strokes, bound: { stroke: "v8" } }));
    expect(withRaw?.style.borderWidth).toBe("raw:1px");
    expect(unbound.warnings).toEqual([]);
  });

  it("R11: reports positive unbound radius values as raw pixels with UNBOUND_DIMENSION", () => {
    const state = stateOf();
    expect(compactNode(state, node({ id: "1", type: "FRAME", radius: 8 }))?.style.radius).toBe("raw:8px");
    expect(state.warnings).toEqual([{ code: "UNBOUND_DIMENSION", nodeId: "1", detail: "8px" }]);
    expect(compactNode(stateOf(), node({ id: "2", type: "FRAME", radius: 0 }))?.style.radius).toBe(undefined);
  });

  it("R12: includes opacity only when it is less than one", () => {
    expect(compactNode(stateOf(), node({ id: "1", type: "FRAME", opacity: 0.5 }))?.style.opacity).toBe("raw:0.5");
    expect(compactNode(stateOf(), node({ id: "2", type: "FRAME", opacity: 1 }))?.style.opacity).toBe(undefined);
  });

  it("R13: omits typo and reports UNBOUND_TYPO without bound.textStyle", () => {
    const state = stateOf();
    const out = compactNode(state, node({ id: "1", type: "TEXT", text: { characters: "Button", fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeight: 20 } }));
    expect(out?.text).toEqual({ content: "Button" });
    expect(state.warnings).toEqual([{ code: "UNBOUND_TYPO", nodeId: "1", detail: "Inter" }]);
  });

  it("R14: compact output omits bbox, type, extra, and default values", () => {
    const out = compactNode(stateOf(), node({ id: "1", type: "FRAME", opacity: 1, extra: { blendMode: "NORMAL" } }));
    expect(out?.raw).toBe(undefined);
    expect(Object.keys(out ?? {}).sort()).toEqual(["children", "id", "layout", "name", "role", "style"]);
  });

  it("R15: emits rounded lowercase hex and appends alpha when a is less than one", () => {
    expect(compactNode(stateOf(), node({ id: "1", type: "FRAME", fills: [{ type: "SOLID", color: { r: 0.945, g: 0.953, b: 0.957, a: 1 } }] }))?.style.bg).toBe("raw:#f1f3f4");
    expect(compactNode(stateOf(), node({ id: "2", type: "FRAME", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 0.5 } }] }))?.style.bg).toBe("raw:#00000080");
  });

  it("R16: full output includes bbox, type, and extra in raw", () => {
    const snapshot = Snapshot.parse({
      version: 1,
      source: { kind: "sample", plan: "unknown", fileKey: "F", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
      collections: [], variables: [], textStyles: [], componentSets: [], annotations: [],
    });
    const state = makeCompactionState(snapshot, "full");
    const out = compactNode(state, node({ id: "1", type: "FRAME", bbox: { x: 1, y: 2, w: 3, h: 4 }, extra: { k: 1 } }));
    expect(out?.raw).toEqual({ bbox: { x: 1, y: 2, w: 3, h: 4 }, type: "FRAME", extra: { k: 1 } });
  });
});

describe("tokensUsed rules (docs/reference/spec.md section 4.4, R17)", () => {
  it("R17: tokensUsed contains token-file leaves and expands compound typography paths", () => {
    const result = buildDesignContext(button(), { name: "Button" });
    const used = result.ok ? result.context.tokensUsed : [];
    // Compound paths have no tokens.css variable. Including them would force consumers to infer the leaves.
    expect(used).not.toContain("typo.label.md");
    expect(used.filter((p) => p.startsWith("typo."))).toEqual([
      "typo.label.md.fontFamily", "typo.label.md.fontSize",
      "typo.label.md.fontWeight", "typo.label.md.lineHeight",
    ]);
    // The button text style has no letterSpacing, so no corresponding leaf is emitted.
    expect(used).not.toContain("typo.label.md.letterSpacing");
    expect(used).toHaveLength(11);
  });

  it("R17: tokensUsed includes the letterSpacing leaf when the text style defines it", () => {
    const style = { id: "s1", name: "label/md", fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeight: 20, letterSpacing: 0.5 };
    const state = stateOf({ textStyles: [style] });
    compactNode(state, node({ id: "1", type: "TEXT", text: { characters: "x", fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeight: 20 }, bound: { textStyle: "s1" } }));
    expect([...state.tokensUsed].sort()).toEqual([
      "typo.label.md.fontFamily", "typo.label.md.fontSize",
      "typo.label.md.fontWeight", "typo.label.md.letterSpacing", "typo.label.md.lineHeight",
    ]);
  });
});

describe("name and token-path rules (docs/reference/spec.md section 4.5)", () => {
  it("N01: replaces slashes in variable names and prefixes text-style paths with typo", () => {
    const result = buildDesignContext(button(), { name: "Button", annotations: true });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.context.tokensUsed : []).toContain("color.button.primary.bg");
    // tokensUsed stores emitted leaves while text.typo retains the compound path.
    expect(result.ok ? result.context.tokensUsed : []).toContain("typo.label.md.fontSize");
    expect(result.ok ? result.context.component.base.root.children[0]?.text?.typo : "").toBe("typo.label.md");
  });

  it("N02: accepts token paths containing one to five valid segments", () => {
    const result = buildDesignContext(button(), { name: "Button" });
    const paths = result.ok ? result.context.tokensUsed : [];
    expect(paths.every((p) => p.split(".").length >= 1 && p.split(".").length <= 5)).toBe(true);
    expect(paths).toEqual([
      "color.button.primary.bg", "color.button.primary.fg",
      "color.button.secondary.bg", "color.button.secondary.fg",
      "radius.md", "space.md", "space.sm",
      "typo.label.md.fontFamily", "typo.label.md.fontSize",
      "typo.label.md.fontWeight", "typo.label.md.lineHeight",
    ]);
  });

  it("N03: reports NON_ASCII_TOKEN_NAME and UNBOUND_* when a variable name contains non-ASCII text", () => {
    const state = stateOf({ variables: [{ ...V_SPACE, name: "space/작게" }] });
    const out = compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v5" } }));
    expect(out?.layout.gap).toBe(8);
    expect(state.warnings.map((w) => w.code).sort()).toEqual(["NON_ASCII_TOKEN_NAME", "UNBOUND_DIMENSION"]);
  });

  it("N03: accepts uppercase and spaces after normalizing each segment to a slug", () => {
    const state = stateOf({ variables: [{ ...V_SPACE, name: "space/Small" }] });
    expect(compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v5" } }))?.layout.gap).toBe("space.small");
    expect(state.warnings).toEqual([]);
  });

  it("N03: accepts multi-segment names containing spaces after slug normalization", () => {
    const state = stateOf({ variables: [{ ...V_COLOR, name: "Background/Default/Default Hover" }] });
    const out = compactNode(state, node({ id: "1", type: "FRAME", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], bound: { fill: "v8" } }));
    expect(out?.style.bg).toBe("background.default.default-hover");
    expect(state.warnings).toEqual([]);
  });

  it("N03: excludes both names with NAME_COLLISION when normalization produces the same path", () => {
    const state = stateOf({ variables: [{ ...V_SPACE, id: "v5", name: "space/SM" }, { ...V_SPACE, id: "v6", name: "space/sm" }] });
    const out = compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v5" } }));
    expect(out?.layout.gap).toBe(8);
    const other = compactNode(state, node({ id: "2", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v6" } }));
    expect(other?.layout.gap).toBe(8);
    expect(state.warnings).toEqual([
      { code: "NAME_COLLISION", nodeId: "v5", detail: "v5" },
      { code: "UNBOUND_DIMENSION", nodeId: "1", detail: "8" },
      { code: "NAME_COLLISION", nodeId: "v6", detail: "v6" },
      { code: "UNBOUND_DIMENSION", nodeId: "2", detail: "8" },
    ]);
  });

  it("N02: accepts a single-segment path as a token reference", () => {
    const state = stateOf({ variables: [{ ...V_SPACE, name: "radius" }] });
    const out = compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v5" } }));
    expect(out?.layout.gap).toBe("radius");
    expect(state.warnings).toEqual([]);
  });

  it("N02: accepts hyphens in the first segment", () => {
    const state = stateOf({ variables: [{ ...V_SPACE, name: "title-page/size-base" }] });
    const out = compactNode(state, node({ id: "1", type: "FRAME", layout: { mode: "HORIZONTAL", gap: 8 }, bound: { gap: "v5" } }));
    expect(out?.layout.gap).toBe("title-page.size-base");
    expect(state.warnings).toEqual([]);
  });

  it("N04: preserves Unicode letters in layer slugs while replacing separators and lowercasing", () => {
    expect(compactNode(stateOf(), node({ id: "1", type: "FRAME", name: "Primary  Button/Large" }))?.name).toBe("primary-button-large");
    expect(compactNode(stateOf(), node({ id: "2", type: "FRAME", name: "확인 버튼" }))?.name).toBe("확인-버튼");
  });

  it("N05: duplicate names with distinct IDs use --node to continue", () => {
    const snapshot = button();
    const clone = structuredClone(snapshot.componentSets[0]);
    if (clone !== undefined) { clone.id = "12:99"; snapshot.componentSets.push(clone); }
    const collided = selectComponentSet(snapshot, "Button");
    expect(collided).toEqual({ ok: false, kind: "collision", name: "Button", candidates: ["12:34", "12:99"] });
    const picked = selectComponentSet(snapshot, "Button", "12:99");
    expect(picked.ok && picked.set.id).toBe("12:99");
  });
});

describe("annotation protocol (docs/reference/spec.md section 4.8)", () => {
  it("classifies only leading tags without interpreting annotation text", () => {
    expect(classify({ nodeId: "1", text: "[a11y] 라벨", source: "sample" })).toEqual({ nodeId: "1", kind: "a11y", text: "라벨" });
    expect(classify({ nodeId: "1", text: "[unknown] 라벨", source: "sample" })).toEqual({ nodeId: "1", kind: "note", text: "[unknown] 라벨" });
  });

  it("sorts annotations by nodeId and text and includes them only with --annotations", () => {
    const withAnnotations = buildDesignContext(button(), { name: "Button", annotations: true });
    expect(withAnnotations.ok ? withAnnotations.context.annotations : []).toEqual([
      { kind: "behavior", nodeId: "12:34", text: "Enter/Space로 활성화. disabled면 aria-disabled=true." },
      { kind: "a11y", nodeId: "12:36", text: "라벨은 시각적으로 숨기지 않는다." },
    ]);
    const without = buildDesignContext(button(), { name: "Button" });
    expect(without.ok ? without.context.annotations : ["x"]).toEqual([]);
  });

  // Synthetic annotations carry the sample source, so a captured file is needed to prove that a
  // devmode source survives the parser.
  it("classifies and sorts the two real-annotated-theme Dev Mode annotations by nodeId and text", () => {
    const snapshot = annotatedTheme();
    expect(snapshot.annotations.map((a) => a.source)).toEqual(["devmode", "devmode"]);
    const withAnnotations = buildDesignContext(snapshot, { name: "Button", annotations: true });
    expect(withAnnotations.ok ? withAnnotations.context.annotations : []).toEqual([
      { kind: "a11y", nodeId: "1:10", text: "라벨을 시각적으로 숨기지 않는다" },
      { kind: "behavior", nodeId: "1:13", text: "Enter/Space로 활성화" },
    ]);
    const without = buildDesignContext(snapshot, { name: "Button" });
    expect(without.ok ? without.context.annotations : ["x"]).toEqual([]);
  });

  it("returns empty when a component set has no components", () => {
    const snapshot = button();
    const set = snapshot.componentSets[0];
    if (set !== undefined) set.components = [];
    expect(selectComponentSet(snapshot, "Button")).toEqual({ ok: false, kind: "empty", name: "Button" });
  });
});

describe("base and variant delta rules (docs/reference/spec.md section 4.3)", () => {
  it("D01: chooses the component made from each property's first value as the base", () => {
    const result = buildDesignContext(button(), { name: "Button" });
    expect(result.ok && result.context.component.base.props).toEqual({ size: "md", variant: "primary" });
    expect(result.ok && result.context.component.base.root.id).toBe("12:35");
  });

  it("D02: includes only changed leaf values in a delta", () => {
    const result = buildDesignContext(button(), { name: "Button" });
    expect(result.ok && result.context.component.variants[0]?.delta).toEqual([
      { path: "/children/0/style/fg", value: "color.button.secondary.fg" },
      { path: "/style/bg", value: "color.button.secondary.bg" },
    ]);
    expect(result.ok && result.context.component.variants[0]?.root).toBe(undefined);
  });

  it("D03: includes the full root and reports VARIANT_STRUCTURE_DIFF when child counts differ", () => {
    const snapshot = button();
    const extra = node({ id: "12:39", type: "RECTANGLE", name: "Badge" });
    snapshot.componentSets[0]?.components[1]?.root.children.push(extra);
    const result = buildDesignContext(snapshot, { name: "Button" });
    expect(result.ok && result.context.component.variants[0]?.root?.children).toHaveLength(2);
    expect(result.ok && result.context.warnings).toEqual([
      { code: "VARIANT_STRUCTURE_DIFF", nodeId: "12:37", detail: "structure differs from base" },
    ]);
  });

  it("D02: compares variants by delta even when root names contain different property strings", () => {
    const snapshot = button();
    const roots = snapshot.componentSets[0]?.components ?? [];
    if (roots[0] !== undefined) roots[0].root.name = "Variant=Primary";
    if (roots[1] !== undefined) roots[1].root.name = "Variant=Secondary";
    const result = buildDesignContext(snapshot, { name: "Button" });
    expect(result.ok && result.context.component.variants[0]?.delta).toEqual([
      { path: "/children/0/style/fg", value: "color.button.secondary.fg" },
      { path: "/style/bg", value: "color.button.secondary.bg" },
    ]);
    expect(result.ok && result.context.warnings.filter((w) => w.code === "VARIANT_STRUCTURE_DIFF")).toEqual([]);
  });

  it("D02: deltaBetween does not treat root-name differences as structural changes", () => {
    const designNode = (name: string): DesignNodeT =>
      ({ id: "n1", role: "container", name, layout: { dir: "row", sizing: { w: "hug", h: "hug" } }, style: {}, children: [] });
    expect(deltaBetween(designNode("variant-primary"), designNode("variant-secondary"))).toEqual([
      { path: "/name", value: "variant-secondary" },
    ]);
  });

  it("R02: uses component.block as the design node name when the root name is a variant property", () => {
    const snapshot = button();
    const roots = snapshot.componentSets[0]?.components ?? [];
    if (roots[0] !== undefined) roots[0].root.name = "Variant=Primary";
    if (roots[1] !== undefined) roots[1].root.name = "Variant=Secondary";
    const result = buildDesignContext(snapshot, { name: "Button" });
    expect(result.ok && result.context.component.block).toBe("button");
    expect(result.ok && result.context.component.base.root.name).toBe("button");
  });

  it("D03: reports VARIANT_STRUCTURE_DIFF when child names differ under equal root names", () => {
    const snapshot = button();
    const child = snapshot.componentSets[0]?.components[1]?.root.children[0];
    if (child !== undefined) child.name = "Caption";
    const result = buildDesignContext(snapshot, { name: "Button" });
    expect(result.ok && result.context.component.variants[0]?.root?.children).toHaveLength(1);
    expect(result.ok && result.context.warnings).toEqual([
      { code: "VARIANT_STRUCTURE_DIFF", nodeId: "12:37", detail: "structure differs from base" },
    ]);
  });

  it("D04: sorts deltas by RFC 6901 path", () => {
    const result = buildDesignContext(button(), { name: "Button" });
    const paths = (result.ok ? result.context.component.variants[0]?.delta ?? [] : []).map((d) => d.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths.every((p) => p.startsWith("/"))).toBe(true);
  });

  it("D05: applyDelta(base.root, delta) deeply equals the compact variant tree", () => {
    const snapshot = button();
    const result = buildDesignContext(snapshot, { name: "Button" });
    const context = result.ok ? result.context : undefined;
    const applied = applyDelta(context?.component.base.root as never, context?.component.variants[0]?.delta ?? []);
    const state = makeCompactionState(snapshot, "compact");
    const variantTree = compactNode(state, snapshot.componentSets[0]?.components[1]?.root as never);
    expect(stripIds(applied)).toEqual(stripIds(variantTree as never));
  });

  it("D05: represents key deletion as null and removes the key when applying the delta", () => {
    const snapshot = button();
    delete snapshot.componentSets[0]?.components[1]?.root.bound.radius;
    const secondary = snapshot.componentSets[0]?.components[1]?.root;
    if (secondary !== undefined) secondary.radius = 0;
    const result = buildDesignContext(snapshot, { name: "Button" });
    const delta = result.ok ? result.context.component.variants[0]?.delta ?? [] : [];
    expect(delta).toContainEqual({ path: "/style/radius", value: null });
    const applied = applyDelta(result.ok ? result.context.component.base.root : ({} as never), delta);
    expect(applied.style.radius).toBe(undefined);
  });

  it("computes contentHash from stable JSON so key order does not change the sha256", () => {
    const first = buildDesignContext(button(), { name: "Button" });
    const shuffled = button();
    shuffled.componentSets[0]?.components.forEach((c) => { c.root.children.reverse(); c.root.children.reverse(); });
    const second = buildDesignContext(shuffled, { name: "Button" });
    expect(first.ok && first.context.source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.ok && second.ok && first.context.source.contentHash).toBe(second.ok ? second.context.source.contentHash : "");
  });
});
