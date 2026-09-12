import { describe, expect, it } from "vitest";
import { PluginExport, Snapshot } from "@tokenloom/schema";
import {
  annotationSummary, boundId, buildExport, collectAnnotations, fontWeightOf,
  toCollections, toRawNode, toTextStyles, toVariables,
  type AnnotatedNode, type FigmaNode,
} from "../src/export";

const NODE: FigmaNode = {
  id: "1:2",
  name: "Button",
  type: "COMPONENT",
  absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 40 },
  layoutMode: "HORIZONTAL",
  itemSpacing: 8,
  paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16,
  primaryAxisAlignItems: "CENTER",
  counterAxisAlignItems: "CENTER",
  layoutSizingHorizontal: "HUG",
  layoutSizingVertical: "HUG",
  fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
  cornerRadius: 8,
  boundVariables: {
    fills: [{ type: "VARIABLE_ALIAS", id: "v1" }],
    itemSpacing: { type: "VARIABLE_ALIAS", id: "v2" },
    paddingTop: { id: "v3" }, paddingRight: { id: "v4" },
    paddingBottom: { id: "v3" }, paddingLeft: { id: "v4" },
  },
  children: [],
};

describe("plugin export conversion (docs/reference/spec.md section 4.1)", () => {
  it("extracts one ID from array or single-value boundVariables", () => {
    expect(boundId(NODE.boundVariables, "fills")).toBe("v1");
    expect(boundId(NODE.boundVariables, "itemSpacing")).toBe("v2");
    expect(boundId(NODE.boundVariables, "strokes")).toBe(undefined);
  });

  it("converts fontName.style to a numeric weight", () => {
    expect(fontWeightOf("SemiBold")).toBe(600);
    expect(fontWeightOf("Regular")).toBe(400);
    expect(fontWeightOf(undefined)).toBe(400);
    expect(fontWeightOf("Extra Bold")).toBe(800);
  });

  it("maps absoluteBoundingBox to bbox and defaults missing boxes to zero", () => {
    expect(toRawNode(NODE).bbox).toEqual({ x: 10, y: 20, w: 100, h: 40 });
    expect(toRawNode({ id: "1", name: "n", type: "FRAME" }).bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("maps Figma layout fields to Snapshot layout", () => {
    const out = toRawNode(NODE);
    expect(out.layout).toEqual({
      mode: "HORIZONTAL", gap: 8, padding: [8, 16, 8, 16],
      primaryAlign: "CENTER", counterAlign: "CENTER", sizingH: "HUG", sizingV: "HUG",
    });
    expect(out.bound).toEqual({ fill: "v1", gap: "v2", padding: ["v3", "v4", "v3", "v4"] });
  });

  it("omits partial padding bindings that JSON cannot represent", () => {
    const partial: FigmaNode = { ...NODE, boundVariables: { paddingTop: { id: "v3" } } };
    expect(toRawNode(partial).bound.padding).toBe(undefined);
  });

  it("folds gradient variants into GRADIENT and unknown paints into OTHER", () => {
    const node: FigmaNode = { ...NODE, fills: [{ type: "GRADIENT_LINEAR" }] };
    expect(toRawNode(node).fills?.[0]?.type).toBe("GRADIENT");
    expect(toRawNode({ ...NODE, fills: [{ type: "VIDEO" }] }).fills?.[0]?.type).toBe("OTHER");
  });

  it("docs/reference/spec.md section 4.1: omits hidden fills and strokes while preserving remaining Figma order", () => {
    const node: FigmaNode = {
      ...NODE,
      fills: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false },
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } },
        { type: "GRADIENT_LINEAR" },
      ],
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: false }],
      strokeWeight: 2,
    };
    expect(toRawNode(node).fills).toEqual([
      { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } },
      { type: "GRADIENT" },
    ]);
    expect(toRawNode(node).strokes).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: removes the first hidden fill together with its binding", () => {
    const node: FigmaNode = {
      ...NODE,
      fills: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false },
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } },
      ],
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "vHidden" }] },
    };
    const out = toRawNode(node);
    expect(out.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]);
    expect(out.bound.fill).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: assigns the first remaining fill binding to bound.fill", () => {
    const node: FigmaNode = {
      ...NODE,
      fills: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false },
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } },
      ],
      boundVariables: { fills: [{ id: "vHidden" }, { id: "vShown" }] },
    };
    expect(toRawNode(node).bound.fill).toBe("vShown");
  });

  it("docs/reference/spec.md section 4.1: prefers paint boundVariables.color over the node-level array", () => {
    const node: FigmaNode = {
      ...NODE,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, boundVariables: { color: { id: "vPaint" } } }],
      boundVariables: { fills: [{ id: "vNode" }] },
    };
    expect(toRawNode(node).bound.fill).toBe("vPaint");
  });

  it("docs/reference/spec.md section 4.1: removes the first hidden stroke together with its binding", () => {
    const node: FigmaNode = {
      ...NODE,
      strokes: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false },
        { type: "SOLID", color: { r: 1, g: 0, b: 0 } },
      ],
      strokeWeight: 2,
      boundVariables: { strokes: [{ id: "vHidden" }] },
    };
    const out = toRawNode(node);
    expect(out.strokes).toEqual([{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2 }]);
    expect(out.bound.stroke).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: maps boundVariables.strokeWeight to bound.strokeWeight", () => {
    const node: FigmaNode = {
      ...NODE,
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      strokeWeight: 1,
      boundVariables: { ...NODE.boundVariables, strokeWeight: { id: "vWeight" } },
    };
    expect(toRawNode(node).bound.strokeWeight).toBe("vWeight");
    expect(toRawNode(NODE).bound.strokeWeight).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: omits the fills key when every fill is hidden", () => {
    const node: FigmaNode = { ...NODE, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false }] };
    expect(toRawNode(node).fills).toBe(undefined);
  });

  it("defaults missing visible to true and preserves false", () => {
    expect(toRawNode(NODE).visible).toBe(true);
    expect(toRawNode({ ...NODE, visible: false }).visible).toBe(false);
  });

  it("maps VARIABLE_ALIAS and color values to alias and Color", () => {
    const vars = toVariables([
      { id: "v1", name: "color/a", variableCollectionId: "c1", resolvedType: "COLOR", valuesByMode: { m0: { r: 1, g: 0, b: 0, a: 1 } } },
      { id: "v2", name: "space/a", variableCollectionId: "c1", resolvedType: "FLOAT", valuesByMode: { m0: 8 } },
      { id: "v3", name: "color/b", variableCollectionId: "c1", resolvedType: "COLOR", valuesByMode: { m0: { type: "VARIABLE_ALIAS", id: "v1" } } },
    ]);
    expect(vars[0]?.valuesByMode.m0).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(vars[1]?.valuesByMode.m0).toBe(8);
    expect(vars[2]?.valuesByMode.m0).toEqual({ alias: "v1" });
  });

  it("omits unknown resolvedType values", () => {
    expect(toVariables([
      { id: "v9", name: "x/y", variableCollectionId: "c1", resolvedType: "IMAGE", valuesByMode: { m0: 1 } },
    ])).toEqual([]);
  });

  it("maps modeId to the Snapshot mode ID", () => {
    expect(toCollections([
      { id: "c1", name: "P", modes: [{ modeId: "m0", name: "Value" }], defaultModeId: "m0" },
    ])).toEqual([{ id: "c1", name: "P", modes: [{ id: "m0", name: "Value" }], defaultModeId: "m0" }]);
  });

  it("includes letterSpacing only when present", () => {
    const [withLs, withoutLs] = toTextStyles([
      { id: "t1", name: "a/b", fontName: { family: "Inter", style: "Bold" }, fontSize: 14, lineHeight: { unit: "PIXELS", value: 20 }, letterSpacing: { unit: "PIXELS", value: 0.5 } },
      { id: "t2", name: "a/c", fontName: { family: "Inter", style: "Regular" }, fontSize: 12, lineHeight: { unit: "PIXELS", value: 16 } },
    ]);
    expect(withLs?.letterSpacing).toBe(0.5);
    expect(withLs?.fontWeight).toBe(700);
    expect(withoutLs?.letterSpacing).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: copies the bundle stamp to source.exporter and omits the key when absent", () => {
    const base = {
      fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
      collections: [], variables: [], textStyles: [], sets: [],
    };
    const stamp = { sha: "1726c7bdeadbeef0000000000000000000000000", builtAt: "2026-09-03T13:00:00Z" };
    expect(buildExport({ ...base, exporter: stamp }).source.exporter).toEqual(stamp);
    expect(Object.keys(buildExport(base).source)).toEqual(["kind", "plan", "fileKey", "fileVersion", "fetchedAt"]);
  });

  it("docs/reference/spec.md section 4.1: records plan as unknown because the plugin cannot read it", () => {
    const built = buildExport({
      fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
      collections: [], variables: [], textStyles: [], sets: [],
    });
    // fileKey is also copied as supplied because this layer cannot discover a missing value.
    expect([built.source.plan, buildExport({
      fileKey: "UNKNOWN", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
      collections: [], variables: [], textStyles: [], sets: [],
    }).source.fileKey]).toEqual(["unknown", "UNKNOWN"]);
  });

  it("produces a PluginExport whose base64-free form is a Snapshot", () => {
    const built = buildExport({
      fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
      page: { id: "0:1", name: "Page 1" },
      collections: [{ id: "c1", name: "P", modes: [{ modeId: "m0", name: "Value" }], defaultModeId: "m0" }],
      variables: [{ id: "v1", name: "color/a", variableCollectionId: "c1", resolvedType: "COLOR", valuesByMode: { m0: { r: 1, g: 0, b: 0, a: 1 } } }],
      textStyles: [],
      sets: [{ id: "1:1", name: "Button", props: { size: ["md"] }, components: [{ id: "1:2", props: { size: "md" }, root: NODE, pngBase64: "AAAA" }] }],
    });
    expect(PluginExport.safeParse(built).success).toBe(true);
    expect(built.componentSets[0]?.components[0]?.renderPngBase64).toBe("AAAA");
    expect(built.source.kind).toBe("plugin");
    const stripped = {
      ...built,
      componentSets: built.componentSets.map((s) => ({
        ...s,
        components: s.components.map(({ renderPngBase64: _png, ...rest }) => rest),
      })),
      page: undefined,
    };
    expect(Snapshot.safeParse(stripped).success).toBe(true);
  });
});

describe("plugin Dev Mode annotation collection (docs/reference/spec.md section 4.8)", () => {
  /**
   * One set root and two children exercise included labels plus ignored labelMarkdown and properties entries.
   * An empty root annotation list separates runtime support detection from mapped annotation count.
   */
  function annotatedTree(): AnnotatedNode[] {
    return [
      { id: "1:1", annotations: [] },
      { id: "1:15", annotations: [{ label: "[a11y] 최소 터치 영역 44px" }] },
      {
        id: "1:10",
        annotations: [
          { label: "[intent] 주 액션" },
          { labelMarkdown: "**[intent]** 마크다운 본문" },
          { properties: [{ type: "fills" }] },
        ],
      },
    ];
  }

  it("includes only labeled annotations as devmode and sorts them by nodeId and text", () => {
    const collected = collectAnnotations(annotatedTree());
    expect(collected.annotations).toEqual([
      { nodeId: "1:10", text: "[intent] 주 액션", source: "devmode" },
      { nodeId: "1:15", text: "[a11y] 최소 터치 영역 44px", source: "devmode" },
    ]);
    expect(collected.support).toBe("read");
  });

  it("includes collected annotations and records source.annotationsSupport as read", () => {
    const collected = collectAnnotations(annotatedTree());
    const built = buildExport({
      fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
      collections: [], variables: [], textStyles: [], sets: [],
      annotations: collected.annotations, annotationsSupport: collected.support,
    });
    expect(built.source.annotationsSupport).toBe("read");
    expect(built.annotations.map((a) => a.nodeId)).toEqual(["1:10", "1:15"]);
  });

  it("records unsupported when the runtime lacks annotations and reflects it in the UI summary", () => {
    const collected = collectAnnotations(annotatedTree().map(({ id }) => ({ id })));
    const built = buildExport({
      fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
      collections: [], variables: [], textStyles: [], sets: [],
      annotations: collected.annotations, annotationsSupport: collected.support,
    });
    expect([built.annotations, built.source.annotationsSupport]).toEqual([[], "unsupported"]);
    expect(annotationSummary(collected)).toEqual({ support: "unsupported", count: 0 });
  });

  it("includes the annotation count in the UI summary after a supported read", () => {
    expect(annotationSummary(collectAnnotations(annotatedTree()))).toEqual({ support: "read", count: 2 });
  });
});
