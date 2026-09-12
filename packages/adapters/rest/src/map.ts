// Figma REST response to Snapshot. Only this file and client.ts know Figma field names (docs/reference/spec.md section 4.1).
// All functions are pure; client.ts supplies network and clock effects.
import type {
  Comment, ComponentPropertyDefinition, GetFileResponse,
  HasChildrenTrait, HasFramePropertiesTrait, HasGeometryTrait, HasLayoutTrait,
  IsLayerTrait, Paint, Style, TypePropertiesTrait, VariableAlias,
} from "@figma/rest-api-spec";
import type { AnnotationT, ColorT, ComponentSetT, RawNodeT, SnapshotT, TextStyleT } from "@tokenloom/schema";
import { visiblePaintsWithBound } from "@tokenloom/schema";

/** Treat the node union as partial traits because REST omits fields that hold default values. */
export type NodeView = Partial<
  IsLayerTrait & HasLayoutTrait & HasFramePropertiesTrait & HasGeometryTrait &
  HasChildrenTrait & TypePropertiesTrait & { componentPropertyDefinitions: Record<string, ComponentPropertyDefinition> } &
  { cornerRadius: number; rectangleCornerRadii: number[]; opacity: number; componentId: string } &
  // `AnnotationsTrait` is empty upstream, so this narrow shape follows captured responses.
  // `properties` marks property-pinned annotations; no text is available to include, but the field is retained.
  { annotations: { label?: unknown; properties?: unknown }[] } &
  // REST types omit uniform strokeWeight although plugin types and captured responses include it.
  { boundVariables: { strokeWeight?: VariableAlias } }
>;

const ZERO_BOX = { x: 0, y: 0, w: 0, h: 0 };

function paintKind(paint: Paint): "SOLID" | "IMAGE" | "GRADIENT" | "OTHER" {
  if (paint.type === "SOLID") return "SOLID";
  if (paint.type === "IMAGE") return "IMAGE";
  return paint.type.startsWith("GRADIENT") ? "GRADIENT" : "OTHER";
}

/** Multiply paint opacity into color alpha because the parser reads only Snapshot alpha. */
function paintColor(paint: Paint): ColorT | undefined {
  if (paint.type !== "SOLID") return undefined;
  const { r, g, b, a } = paint.color;
  return { r, g, b, a: a * (paint.opacity ?? 1) };
}

/**
 * docs/reference/spec.md section 4.1 filters paints with their bindings.
 * REST SolidPaint `boundVariables.color` is canonical; the undocumented node-level array is fallback only
 * when one side lacks the binding (docs/adr/0005-read-variable-bindings-from-the-paint.md).
 */
type PaintPair = { paint: Paint; bound: string | undefined };

function boundIdOf(paint: Paint, nodeLevel: { id: string } | undefined): string | undefined {
  if (paint.type === "SOLID" && paint.boundVariables?.color !== undefined) return paint.boundVariables.color.id;
  return nodeLevel?.id;
}

function paintPairs(paints: Paint[] | undefined, nodeLevel: readonly { id: string }[] | undefined): PaintPair[] {
  const shown = paints ?? [];
  return visiblePaintsWithBound(shown, shown.map((p, i) => boundIdOf(p, nodeLevel?.[i])));
}

function toFills(pairs: PaintPair[]): RawNodeT["fills"] {
  if (pairs.length === 0) return undefined;
  return pairs.map(({ paint }) => ({ type: paintKind(paint), color: paintColor(paint) }));
}

function toStrokes(pairs: PaintPair[], strokeWeight: number | undefined): RawNodeT["strokes"] {
  if (pairs.length === 0) return undefined;
  const weight = strokeWeight ?? 0;
  return pairs.map(({ paint }) => ({ color: paintColor(paint) ?? { r: 0, g: 0, b: 0, a: 1 }, weight }));
}

function toRadius(node: NodeView): RawNodeT["radius"] {
  const corners = node.rectangleCornerRadii;
  if (corners !== undefined && corners.length === 4) {
    return [corners[0] as number, corners[1] as number, corners[2] as number, corners[3] as number];
  }
  return node.cornerRadius;
}

/**
 * Missing REST `layoutMode` means no auto layout. Lower unsupported GRID to NONE so parser rule R04 handles it.
 */
function toLayout(node: NodeView): RawNodeT["layout"] {
  if (node.layoutMode === undefined) return undefined;
  const mode = node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL" ? node.layoutMode : "NONE";
  const pad: [number, number, number, number] = [
    node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0,
  ];
  const primary = node.primaryAxisSizingMode === "AUTO" ? "HUG" : "FIXED";
  const counter = node.counterAxisSizingMode === "AUTO" ? "HUG" : "FIXED";
  const counterAlign = node.counterAxisAlignItems === "BASELINE" ? "MIN" : node.counterAxisAlignItems;
  return {
    mode,
    gap: node.itemSpacing,
    padding: pad.some((v) => v !== 0) ? pad : undefined,
    primaryAlign: node.primaryAxisAlignItems,
    counterAlign,
    sizingH: mode === "VERTICAL" ? counter : primary,
    sizingV: mode === "VERTICAL" ? primary : counter,
  };
}

function toText(node: NodeView): RawNodeT["text"] {
  if (node.characters === undefined || node.style === undefined) return undefined;
  const s = node.style;
  const fontSize = s.fontSize ?? 0;
  return {
    characters: node.characters,
    fontFamily: s.fontFamily ?? "",
    fontSize,
    fontWeight: s.fontWeight ?? 400,
    lineHeight: s.lineHeightPx ?? fontSize,
  };
}

/** `boundVariables` is the only variable source because Variables REST returns 403 on Starter. */
function toBound(node: NodeView, fill: string | undefined, stroke: string | undefined): RawNodeT["bound"] {
  const bv = node.boundVariables;
  const pad: [string?, string?, string?, string?] = [
    bv?.paddingTop?.id, bv?.paddingRight?.id, bv?.paddingBottom?.id, bv?.paddingLeft?.id,
  ];
  return {
    fill,
    stroke,
    strokeWeight: bv?.strokeWeight?.id,
    gap: bv?.itemSpacing?.id,
    padding: pad.some((v) => v !== undefined) ? pad : undefined,
    radius: bv?.topLeftRadius?.id,
    textStyle: node.styles?.text,
    opacity: bv?.opacity?.id,
  };
}

export function toRawNode(node: NodeView): RawNodeT {
  const box = node.absoluteBoundingBox;
  const fills = paintPairs(node.fills, node.boundVariables?.fills);
  // Remove non-SOLID strokes with their bindings because Snapshot cannot represent them.
  const strokes = paintPairs(node.strokes, node.boundVariables?.strokes).filter((p) => p.paint.type === "SOLID");
  return {
    id: node.id ?? "",
    name: node.name ?? "",
    type: node.type ?? "UNKNOWN",
    // REST omits `visible` for visible nodes, so absence means true.
    visible: node.visible !== false,
    bbox: box === null || box === undefined ? { ...ZERO_BOX } : { x: box.x, y: box.y, w: box.width, h: box.height },
    layout: toLayout(node),
    fills: toFills(fills),
    strokes: toStrokes(strokes, node.strokeWeight),
    radius: toRadius(node),
    opacity: node.opacity === 1 ? undefined : node.opacity,
    text: toText(node),
    bound: toBound(node, fills[0]?.bound, strokes[0]?.bound),
    mainComponentId: node.componentId,
    children: (node.children ?? []).map((child) => toRawNode(child)),
  };
}

/** Parse variant names such as `variant=primary, size=md`; text without `=` is not a variant. */
export function parseVariantName(name: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const part of name.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return props;
}

/** Preserve Figma value order so REST and plugin adapters produce the same Snapshot for one file. */
function definedProps(defs: Record<string, ComponentPropertyDefinition> | undefined): Record<string, string[]> | null {
  if (defs === undefined) return null;
  const props: Record<string, string[]> = {};
  for (const [key, def] of Object.entries(defs)) {
    if (def.type !== "VARIANT") continue;
    props[key] = [...(def.variantOptions ?? [])];
  }
  return Object.keys(props).length === 0 ? null : props;
}

function unionProps(components: { props: Record<string, string> }[]): Record<string, string[]> {
  const seen = new Map<string, Set<string>>();
  for (const c of components) {
    for (const [key, value] of Object.entries(c.props)) {
      const set = seen.get(key) ?? new Set<string>();
      set.add(value);
      seen.set(key, set);
    }
  }
  const props: Record<string, string[]> = {};
  for (const key of [...seen.keys()].sort()) props[key] = [...(seen.get(key) as Set<string>)].sort();
  return props;
}

/**
 * Convert one COMPONENT_SET to a Snapshot componentSet while preserving Figma child order for D01.
 * Keep component-root names unchanged to match the plugin adapter; only parser `slug()` normalizes names.
 */
export function toComponentSet(node: NodeView): ComponentSetT | null {
  if (node.type !== "COMPONENT_SET") return null;
  const components = (node.children ?? [])
    .filter((child) => child.type === "COMPONENT")
    .map((child) => ({ id: child.id, props: parseVariantName(child.name), root: toRawNode(child) }));
  return {
    id: node.id ?? "",
    name: node.name ?? "",
    props: definedProps(node.componentPropertyDefinitions) ?? unionProps(components),
    components,
  };
}

/**
 * Collect only text styles referenced by nodes.
 * Tier 3 style-detail calls exceed the Starter budget, so combine file-level names with node-level values.
 */
export function collectTextStyles(sets: ComponentSetT[], styles: Record<string, Style>): TextStyleT[] {
  const found = new Map<string, TextStyleT>();
  const walk = (node: RawNodeT): void => {
    const id = node.bound.textStyle;
    if (id !== undefined && node.text !== undefined && !found.has(id)) {
      found.set(id, {
        id,
        name: styles[id]?.name ?? id,
        fontFamily: node.text.fontFamily,
        fontSize: node.text.fontSize,
        fontWeight: node.text.fontWeight,
        lineHeight: node.text.lineHeight,
      });
    }
    for (const child of node.children) walk(child);
  };
  for (const set of sets) for (const c of set.components) walk(c.root);
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Convert Tier 2 comments to annotations, omitting canvas comments and replies (docs/reference/spec.md section 0.1).
 * buildSnapshot sorts once after combining both annotation sources.
 */
export function toAnnotations(comments: Comment[]): AnnotationT[] {
  const out: AnnotationT[] = [];
  for (const c of comments) {
    if (c.parent_id !== undefined && c.parent_id !== "") continue;
    // Only node-relative FrameOffset metadata has a node anchor; Vector metadata uses canvas coordinates.
    if (!("node_id" in c.client_meta) || c.client_meta.node_id === "") continue;
    out.push({ nodeId: c.client_meta.node_id, text: c.message, author: c.user.handle, source: "comment" });
  }
  return out;
}

/**
 * Convert node Dev Mode annotations returned by Pro and higher `nodes` responses (docs/reference/spec.md section 0).
 * Match plugin `collectAnnotations` so both paths produce identical bytes for one file.
 * Only non-empty `label` text is included; author, labelMarkdown, and properties are omitted by both adapters.
 */
export function toDevmodeAnnotations(roots: readonly NodeView[]): AnnotationT[] {
  const out: AnnotationT[] = [];
  const walk = (node: NodeView): void => {
    for (const annotation of node.annotations ?? []) {
      const text = annotation.label;
      if (typeof text === "string" && text !== "") out.push({ nodeId: node.id ?? "", text, source: "devmode" });
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Sort annotations only by `(nodeId, text)` code points, matching plugin `collectAnnotations` (docs/reference/spec.md section 4.8). */
function byNodeIdThenText(a: AnnotationT, b: AnnotationT): number {
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
}

export interface SnapshotInput {
  fileKey: string;
  fileVersion: string;
  fetchedAt: string;
  plan: SnapshotT["source"]["plan"];
  componentSets: ComponentSetT[];
  textStyles: TextStyleT[];
  /** Combined comment and Dev Mode annotations; ordering is applied later. */
  annotations: AnnotationT[];
}

/**
 * `collections` and `variables` remain empty because Variables REST returns 403 on Starter (docs/reference/spec.md section 0).
 * Node bindings retain variable IDs, so the parser continues with UNBOUND_* warnings. Plugin exports supply values.
 */
export function buildSnapshot(input: SnapshotInput): SnapshotT {
  return {
    version: 1,
    source: {
      kind: "rest",
      plan: input.plan,
      fileKey: input.fileKey,
      fileVersion: input.fileVersion,
      fetchedAt: input.fetchedAt,
      apiVersion: "v1",
      // REST mapping always supports reading node annotations, so this is a constant rather than SnapshotInput data.
      annotationsSupport: "read",
    },
    collections: [],
    variables: [],
    textStyles: input.textStyles,
    componentSets: input.componentSets,
    annotations: [...input.annotations].sort(byNodeIdThenText),
  };
}

/** One discovered set. `parents` is the name chain from the page (docs/reference/spec.md section 0.1). */
export interface DiscoveredSet {
  id: string;
  /** Page-to-section-to-frame order, excluding the set itself. */
  parents: string[];
}

/**
 * Select COMPONENT_SET nodes from discovery, optionally by name.
 * Traverse the entire returned tree because sets are often nested inside sections or frames; `discoverDepth`
 * determines data absent from the response. Parent chains help snapshot comparison distinguish locations.
 */
export function discoverSets(file: GetFileResponse, names?: string[]): DiscoveredSet[] {
  const wanted = names === undefined ? null : new Set(names);
  const found: DiscoveredSet[] = [];
  const walk = (node: NodeView, parents: string[]): void => {
    if (node.type === "COMPONENT_SET") {
      // Component sets cannot contain component sets, so stop descending here.
      if (wanted === null || wanted.has(node.name ?? "")) found.push({ id: node.id ?? "", parents });
      return;
    }
    const chain = [...parents, node.name ?? ""];
    for (const child of node.children ?? []) walk(child, chain);
  };
  for (const page of file.document.children) walk(page, []);
  return found;
}
