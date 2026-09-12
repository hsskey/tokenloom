// Only this package knows Figma field names (docs/reference/spec.md section 4.1 boundary).
// These pure transforms are testable without the figma global; code.ts owns API calls.
import type {
  AnnotationT, CollectionT, PluginExportT, RawNodeT, TextStyleT, VariableT,
} from "@tokenloom/schema";

/** Minimal shape supplied by the plugin API, independent of figma global types. */
export interface FigmaColor { r: number; g: number; b: number; a?: number }
export interface FigmaBinding { id?: unknown }
/** A paint carries its own binding through `SolidPaint.boundVariables.color`. */
export interface FigmaPaint {
  type: string; color?: FigmaColor; opacity?: number; visible?: boolean;
  boundVariables?: { color?: FigmaBinding };
}
export type FigmaStroke = FigmaPaint;

export interface FigmaVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
}

export interface FigmaCollection {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
}

export interface FigmaTextStyle {
  id: string;
  name: string;
  fontName?: { family: string; style: string };
  fontSize?: number;
  lineHeight?: { unit: string; value?: number };
  letterSpacing?: { unit: string; value?: number };
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  fills?: readonly FigmaPaint[];
  strokes?: readonly FigmaStroke[];
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  lineHeight?: { unit: string; value?: number };
  textStyleId?: string;
  boundVariables?: Record<string, unknown>;
  children?: readonly FigmaNode[];
}

/**
 * The only supported way to read the main component from a live INSTANCE.
 * With `documentAccess: "dynamic-page"`, the synchronous `mainComponent` getter throws
 * (`@figma/plugin-typings` InstanceNode.mainComponent: "this property is **write-only**").
 * Structural types keep this testable without the figma global.
 */
export interface LiveInstance {
  id: string;
  getMainComponentAsync(): Promise<{ id: string } | null>;
}

export interface LiveRoot {
  findAllWithCriteria?(criteria: { types: ["INSTANCE"] }): readonly LiveInstance[];
}

/** Resolve nodeId to mainComponentId before traversal. Detached test nodes produce an empty result. */
export async function collectMainIds(roots: readonly LiveRoot[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const root of roots) {
    for (const instance of root.findAllWithCriteria?.({ types: ["INSTANCE"] }) ?? []) {
      const main = await instance.getMainComponentAsync();
      if (main !== null) out.set(instance.id, main.id);
    }
  }
  return out;
}

/** Minimal Dev Mode annotation shape used by this adapter. */
export interface FigmaAnnotation {
  label?: string;
  /** Markdown body retained in the runtime shape but intentionally ignored by both adapters (docs/reference/spec.md section 4.8). */
  labelMarkdown?: string;
  /** Property indicators such as dimensions or colors; they contain no text for the Snapshot. */
  properties?: readonly { type: string }[];
}

/** Node shape used for annotations. The runtime may omit `annotations`, so it is optional. */
export interface AnnotatedNode {
  id: string;
  annotations?: readonly FigmaAnnotation[];
}

export type AnnotationSupport = "read" | "unsupported";

export interface CollectedAnnotations {
  support: AnnotationSupport;
  annotations: AnnotationT[];
}

/** Extract annotation text only from `label`, matching REST `toDevmodeAnnotations` (docs/reference/spec.md section 4.8). */
function annotationText(annotation: FigmaAnnotation): string | undefined {
  const label = annotation.label;
  return typeof label === "string" && label !== "" ? label : undefined;
}

/**
 * docs/reference/spec.md section 4.8 collects Dev Mode annotations from set roots and descendants.
 * The parser classifies tags, so the plugin preserves original text.
 * Runtime property presence determines support. A visited node with `annotations` means `read`; otherwise
 * the result is `unsupported`, including pages with no visited nodes.
 * Supported runtimes apply `AnnotationsMixin` across scene nodes. Missing or empty labels are omitted.
 * Sorting by `(nodeId, text)` matches the design-context order and keeps identical files byte-identical.
 */
export function collectAnnotations(nodes: readonly AnnotatedNode[]): CollectedAnnotations {
  const annotations: AnnotationT[] = [];
  let support: AnnotationSupport = "unsupported";
  for (const node of nodes) {
    if (!("annotations" in node)) continue;
    support = "read";
    for (const annotation of node.annotations ?? []) {
      const text = annotationText(annotation);
      if (text !== undefined) annotations.push({ nodeId: node.id, text, source: "devmode" });
    }
  }
  annotations.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return { support, annotations };
}

/** Values used by the UI summary. Counts do not enter the Snapshot. */
export function annotationSummary(collected: CollectedAnnotations): { support: AnnotationSupport; count: number } {
  return { support: collected.support, count: collected.annotations.length };
}

const WEIGHT_BY_STYLE: Record<string, number> = {
  Thin: 100, ExtraLight: 200, Light: 300, Regular: 400,
  Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900,
};

export function fontWeightOf(style: string | undefined): number {
  return WEIGHT_BY_STYLE[(style ?? "Regular").replace(/\s+/g, "")] ?? 400;
}

/** Extract one variable ID from the single-alias or array forms of `boundVariables`. */
export function boundId(bound: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = bound?.[field];
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "object" || first === null) return undefined;
  const id = (first as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * `boundVariables.fills` and `strokes` are node-level aggregate views without a typed index pairing to paints.
 * Prefer each paint's `boundVariables.color`, using the same aggregate index only as a fallback
 * (`docs/adr/0005-read-variable-bindings-from-the-paint.md`).
 */
function nodeLevelIds(bound: Record<string, unknown> | undefined, field: string): (string | undefined)[] {
  const value = bound?.[field];
  return (Array.isArray(value) ? value : [value]).map((v) => idOf(v));
}

function idOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

export interface PaintPair { paint: FigmaPaint; bound: string | undefined }
type ColorLike = { r: number; g: number; b: number; a: number };

/**
 * docs/reference/spec.md section 4.1 filters paints and bindings together, removing a hidden paint with its binding.
 * This duplicates `visiblePaintsWithBound` because importing the schema would pull Zod into the plugin bundle,
 * increasing it from 12.4 KB to 153 KB (docs/adr/0005-read-variable-bindings-from-the-paint.md).
 */
function paintPairs(paints: readonly FigmaPaint[] | undefined, field: string, bv: Record<string, unknown> | undefined): PaintPair[] {
  // `fills` may be the figma.mixed symbol; non-array values represent no usable paints.
  if (!Array.isArray(paints)) return [];
  const ids = nodeLevelIds(bv, field);
  return paints.flatMap((paint, i) =>
    paint.visible === false ? [] : [{ paint, bound: idOf(paint.boundVariables?.color) ?? ids[i] }]);
}

export function toCollections(collections: readonly FigmaCollection[]): CollectionT[] {
  return collections.map((c) => ({
    id: c.id,
    name: c.name,
    modes: c.modes.map((m) => ({ id: m.modeId, name: m.name })),
    defaultModeId: c.defaultModeId,
  }));
}

const TYPE_MAP: Record<string, VariableT["type"]> = {
  COLOR: "COLOR", FLOAT: "FLOAT", STRING: "STRING", BOOLEAN: "BOOLEAN",
};

export function toVariables(variables: readonly FigmaVariable[]): VariableT[] {
  const out: VariableT[] = [];
  for (const v of variables) {
    const type = TYPE_MAP[v.resolvedType];
    if (type === undefined) continue;
    const valuesByMode: VariableT["valuesByMode"] = {};
    for (const [mode, raw] of Object.entries(v.valuesByMode)) {
      const value = toVarValue(raw);
      if (value !== undefined) valuesByMode[mode] = value;
    }
    out.push({ id: v.id, name: v.name, collectionId: v.variableCollectionId, type, valuesByMode });
  }
  return out;
}

function toVarValue(raw: unknown): VariableT["valuesByMode"][string] | undefined {
  if (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.type === "VARIABLE_ALIAS" && typeof record.id === "string") return { alias: record.id };
  if (typeof record.r === "number" && typeof record.g === "number" && typeof record.b === "number") {
    return { r: record.r, g: record.g, b: record.b, a: typeof record.a === "number" ? record.a : 1 };
  }
  return undefined;
}

export function toTextStyles(styles: readonly FigmaTextStyle[]): TextStyleT[] {
  return styles.map((s) => {
    const size = s.fontSize ?? 0;
    const style: TextStyleT = {
      id: s.id,
      name: s.name,
      fontFamily: s.fontName?.family ?? "",
      fontSize: size,
      fontWeight: fontWeightOf(s.fontName?.style),
      lineHeight: s.lineHeight?.value ?? size,
    };
    if (s.letterSpacing?.value !== undefined) style.letterSpacing = s.letterSpacing.value;
    return style;
  });
}

const ALIGN_KEYS = ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"];
const SIZING_KEYS = ["HUG", "FILL", "FIXED"];

/** Convert a Figma node to Snapshot RawNode while preserving unknown fields in `extra` (docs/reference/spec.md section 10). */
export function toRawNode(node: FigmaNode, mainIds?: ReadonlyMap<string, string>): RawNodeT {
  const box = node.absoluteBoundingBox;
  const fillPairs = paintPairs(node.fills, "fills", node.boundVariables);
  // Snapshot cannot represent strokes without colors, so remove each such stroke with its binding.
  const strokePairs = paintPairs(node.strokes, "strokes", node.boundVariables).flatMap(({ paint, bound }) =>
    paint.color === undefined ? [] : [{ color: { ...paint.color, a: paint.color.a ?? 1 }, bound }]);
  const out: RawNodeT = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    bbox: { x: box?.x ?? 0, y: box?.y ?? 0, w: box?.width ?? 0, h: box?.height ?? 0 },
    bound: toBound(node, fillPairs[0]?.bound, strokePairs[0]?.bound),
    children: (node.children ?? []).map((c) => toRawNode(c, mainIds)),
    extra: { strokeWeight: node.strokeWeight ?? 0 },
  };
  const layout = toLayout(node);
  if (layout !== undefined) out.layout = layout;
  const fills = toFills(fillPairs);
  if (fills !== undefined) out.fills = fills;
  const strokes = toStrokes(strokePairs, node.strokeWeight);
  if (strokes !== undefined) out.strokes = strokes;
  if (node.cornerRadius !== undefined) out.radius = node.cornerRadius;
  if (node.opacity !== undefined) out.opacity = node.opacity;
  if (node.characters !== undefined) {
    out.text = {
      characters: node.characters,
      fontFamily: node.fontName?.family ?? "",
      fontSize: node.fontSize ?? 0,
      fontWeight: fontWeightOf(node.fontName?.style),
      lineHeight: node.lineHeight?.value ?? node.fontSize ?? 0,
    };
  }
  const mainId = mainIds?.get(node.id);
  if (mainId !== undefined) out.mainComponentId = mainId;
  return out;
}

function toLayout(node: FigmaNode): RawNodeT["layout"] {
  const mode = node.layoutMode;
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL" && mode !== "NONE") return undefined;
  const layout: NonNullable<RawNodeT["layout"]> = { mode };
  if (node.itemSpacing !== undefined) layout.gap = node.itemSpacing;
  const pads = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  if (pads.some((p) => p !== undefined)) {
    layout.padding = [pads[0] ?? 0, pads[1] ?? 0, pads[2] ?? 0, pads[3] ?? 0];
  }
  const primary = node.primaryAxisAlignItems;
  if (primary !== undefined && ALIGN_KEYS.includes(primary)) {
    layout.primaryAlign = primary as NonNullable<RawNodeT["layout"]>["primaryAlign"];
  }
  const counter = node.counterAxisAlignItems;
  if (counter !== undefined && ["MIN", "CENTER", "MAX"].includes(counter)) {
    layout.counterAlign = counter as NonNullable<RawNodeT["layout"]>["counterAlign"];
  }
  const h = node.layoutSizingHorizontal;
  if (h !== undefined && SIZING_KEYS.includes(h)) layout.sizingH = h as NonNullable<RawNodeT["layout"]>["sizingH"];
  const v = node.layoutSizingVertical;
  if (v !== undefined && SIZING_KEYS.includes(v)) layout.sizingV = v as NonNullable<RawNodeT["layout"]>["sizingV"];
  return layout;
}

const FILL_TYPES = ["SOLID", "IMAGE", "GRADIENT"];

function toFills(pairs: readonly PaintPair[]): RawNodeT["fills"] {
  if (pairs.length === 0) return undefined;
  return pairs.map(({ paint: f }) => {
    const type = f.type.startsWith("GRADIENT") ? "GRADIENT" : f.type;
    const kind = FILL_TYPES.includes(type) ? type : "OTHER";
    const entry: NonNullable<RawNodeT["fills"]>[number] = {
      type: kind as NonNullable<RawNodeT["fills"]>[number]["type"],
    };
    if (f.color !== undefined) entry.color = { ...f.color, a: f.color.a ?? 1 };
    return entry;
  });
}

function toStrokes(pairs: readonly { color: ColorLike }[], strokeWeight: number | undefined): RawNodeT["strokes"] {
  if (pairs.length === 0) return undefined;
  return pairs.map(({ color }) => ({ color, weight: strokeWeight ?? 1 }));
}

function toBound(node: FigmaNode, fill: string | undefined, stroke: string | undefined): RawNodeT["bound"] {
  const bv = node.boundVariables;
  const bound: RawNodeT["bound"] = {};
  if (fill !== undefined) bound.fill = fill;
  if (stroke !== undefined) bound.stroke = stroke;
  const strokeWeight = boundId(bv, "strokeWeight");
  if (strokeWeight !== undefined) bound.strokeWeight = strokeWeight;
  const gap = boundId(bv, "itemSpacing");
  if (gap !== undefined) bound.gap = gap;
  const radius = boundId(bv, "topLeftRadius") ?? boundId(bv, "cornerRadius");
  if (radius !== undefined) bound.radius = radius;
  const opacity = boundId(bv, "opacity");
  if (opacity !== undefined) bound.opacity = opacity;
  if (node.textStyleId !== undefined && node.textStyleId !== "") bound.textStyle = node.textStyleId;
  const pads = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((k) => boundId(bv, k));
  // Include padding bindings only when all four sides are bound because JSON cannot represent undefined.
  if (pads.every((p) => p !== undefined)) bound.padding = pads as [string, string, string, string];
  return bound;
}

export interface ExportSource {
  fileKey: string;
  fileVersion: string;
  fetchedAt: string;
  page?: { id: string; name: string };
  collections: readonly FigmaCollection[];
  variables: readonly FigmaVariable[];
  textStyles: readonly FigmaTextStyle[];
  sets: readonly {
    id: string;
    name: string;
    props: Record<string, string[]>;
    components: readonly { id: string; props: Record<string, string>; root: FigmaNode; pngBase64?: string }[];
  }[];
  annotations?: readonly AnnotationT[];
  /** Whether the export runtime could read node annotations, as determined by `collectAnnotations`. */
  annotationsSupport?: AnnotationSupport;
  /** nodeId to mainComponentId resolved by `collectMainIds`. */
  mainIds?: ReadonlyMap<string, string>;
  /**
   * Bundle stamp embedded at build time by code.ts through esbuild `--define`.
   * It identifies the commit that built the bundle rather than the Figma export runtime.
   */
  exporter?: { sha: string; builtAt: string };
}

/** Convert one page fragment to PluginExport. The CLI merges fragments through `--from a,b`. */
export function buildExport(source: ExportSource): PluginExportT {
  return {
    version: 1,
    source: {
      kind: "plugin",
      // The plugin cannot read the file plan, so it records unknown instead of guessing.
      // A caller with that context can supply it through `snapshot import --plan` (docs/reference/spec.md section 4.9).
      plan: "unknown",
      // For the same reason, code.ts supplies `figma.fileKey ?? "UNKNOWN"`; this layer only copies it.
      fileKey: source.fileKey,
      fileVersion: source.fileVersion,
      fetchedAt: source.fetchedAt,
      ...(source.exporter === undefined ? {} : { exporter: source.exporter }),
      ...(source.annotationsSupport === undefined ? {} : { annotationsSupport: source.annotationsSupport }),
    },
    collections: toCollections(source.collections),
    variables: toVariables(source.variables),
    textStyles: toTextStyles(source.textStyles),
    componentSets: source.sets.map((set) => ({
      id: set.id,
      name: set.name,
      props: set.props,
      components: set.components.map((c) => ({
        id: c.id,
        props: c.props,
        root: toRawNode(c.root, source.mainIds),
        ...(c.pngBase64 === undefined ? {} : { renderPngBase64: c.pngBase64 }),
      })),
    })),
    annotations: [...(source.annotations ?? [])],
    ...(source.page === undefined ? {} : { page: source.page }),
  };
}
