import type { DesignNodeT, RawNodeT, SnapshotT, WarningT } from "@tokenloom/schema";
import { resolveTokenNames, slug, toHex } from "@tokenloom/schema";

const ICON_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "LINE", "STAR", "REGULAR_POLYGON"]);
const CONTAINER_TYPES = new Set(["FRAME", "COMPONENT", "GROUP", "RECTANGLE"]);
const ICON_MAX = 48;

export type ContextLevel = "compact" | "full";

export interface CompactionState {
  level: ContextLevel;
  /** Variable ID to canonical token path. Excluded variables are absent. */
  tokenPathOf: Map<string, string>;
  /** Text-style ID to `typo.` path. */
  typoPathOf: Map<string, string>;
  /** Main-component ID to slug, used by INSTANCE `instanceOf`. */
  instanceSlugOf: Map<string, string>;
  /** Variant-root node ID to block slug, used to normalize root names. */
  blockOfRoot: Map<string, string>;
  /** Text-style ID to leaf paths that exist in token files. */
  typoLeavesOf: Map<string, string[]>;
  warnings: WarningT[];
  tokensUsed: Set<string>;
  /** Variable and text-style IDs present in the Snapshot. Unknown IDs are simply unbound. */
  knownIds: Set<string>;
  /** Excluded ID to reason. References to excluded IDs are treated as unbound. */
  excluded: Map<string, "NAME_COLLISION" | "NON_ASCII_TOKEN_NAME">;
  /** Excluded IDs already reported, preventing duplicate warnings for one variable. */
  reportedExcluded: Set<string>;
}

/** Text-style leaves emitted to token files; letterSpacing is included only when present. */
const TYPO_LEAVES = ["fontFamily", "fontSize", "fontWeight", "lineHeight"] as const;

export function makeCompactionState(snapshot: SnapshotT, level: ContextLevel): CompactionState {
  // Parser references and emitted tokens must share one namespace and exclusion set.
  const { pathOf, excluded } = resolveTokenNames([
    ...snapshot.variables.map((v) => ({ id: v.id, name: v.name })),
    ...snapshot.textStyles.map((s) => ({ id: s.id, name: s.name, prefix: "typo" })),
  ]);
  const tokenPathOf = new Map<string, string>();
  const typoPathOf = new Map<string, string>();
  const typoLeavesOf = new Map<string, string[]>();
  for (const v of snapshot.variables) {
    const path = pathOf.get(v.id);
    if (path !== undefined) tokenPathOf.set(v.id, path);
  }
  for (const s of snapshot.textStyles) {
    const path = pathOf.get(s.id);
    if (path === undefined) continue;
    typoPathOf.set(s.id, path);
    const leaves = TYPO_LEAVES.map((leaf) => `${path}.${leaf}`);
    if (s.letterSpacing !== undefined) leaves.push(`${path}.letterSpacing`);
    typoLeavesOf.set(s.id, leaves);
  }
  const knownIds = new Set<string>([...snapshot.variables.map((v) => v.id), ...snapshot.textStyles.map((s) => s.id)]);
  const instanceSlugOf = new Map<string, string>();
  const blockOfRoot = new Map<string, string>();
  for (const set of snapshot.componentSets) {
    instanceSlugOf.set(set.id, slug(set.name));
    for (const c of set.components) {
      instanceSlugOf.set(c.id, slug(set.name));
      blockOfRoot.set(c.root.id, slug(set.name));
    }
  }
  return {
    level, tokenPathOf, typoPathOf, typoLeavesOf, instanceSlugOf, blockOfRoot, knownIds, excluded,
    warnings: [], tokensUsed: new Set(), reportedExcluded: new Set(),
  };
}

function warn(state: CompactionState, code: WarningT["code"], nodeId: string, detail: string): void {
  state.warnings.push({ code, nodeId, detail });
}

/**
 * Resolves a bound ID to its token path.
 * An ID present in the Snapshot but absent from the map was excluded during name resolution, so its
 * reason is reported once and the reference is treated as unbound. The caller records tokensUsed.
 */
function lookup(state: CompactionState, id: string | undefined, table: Map<string, string>): string | null {
  if (id === undefined) return null;
  const path = table.get(id);
  if (path === undefined) {
    const code = state.excluded.get(id);
    if (code !== undefined && state.knownIds.has(id) && !state.reportedExcluded.has(id)) {
      state.reportedExcluded.add(id);
      warn(state, code, id, id);
    }
    return null;
  }
  return path;
}

function refOf(state: CompactionState, varId: string | undefined): string | null {
  const path = lookup(state, varId, state.tokenPathOf);
  if (path !== null) state.tokensUsed.add(path);
  return path;
}

/** Return a TokenRef when bound; otherwise return a positive value and warn about the dimension. */
function dimension(state: CompactionState, varId: string | undefined, value: number, nodeId: string): string | number | undefined {
  const ref = refOf(state, varId);
  if (ref !== null) return ref;
  if (value <= 0) return undefined;
  warn(state, "UNBOUND_DIMENSION", nodeId, String(value));
  return value;
}

type Rgba = { r: number; g: number; b: number; a: number };

/** Return a TokenRef when bound; otherwise return `raw:<hex>` and warn about the color. */
function colorValue(state: CompactionState, varId: string | undefined, color: Rgba, nodeId: string): string {
  const ref = refOf(state, varId);
  if (ref !== null) return ref;
  const hex = toHex(color);
  warn(state, "UNBOUND_COLOR", nodeId, hex);
  return `raw:${hex}`;
}

/** Map node types to roles. The fallback always returns unknown with a warning. */
export function roleOf(state: CompactionState, node: RawNodeT): DesignNodeT["role"] {
  if (node.type === "TEXT") return "text";
  if (node.type === "INSTANCE") return "instance";
  if (node.fills?.[0]?.type === "IMAGE") return "image";
  if (ICON_TYPES.has(node.type) && node.bbox.w <= ICON_MAX && node.bbox.h <= ICON_MAX) return "icon";
  if (CONTAINER_TYPES.has(node.type)) return "container";
  warn(state, "UNKNOWN_NODE_TYPE", node.id, node.type);
  return "unknown";
}

const ALIGN: Record<string, "start" | "center" | "end" | "between"> = {
  MIN: "start", CENTER: "center", MAX: "end", SPACE_BETWEEN: "between",
};
const SIZING: Record<string, "hug" | "fill" | "fixed"> = { HUG: "hug", FILL: "fill", FIXED: "fixed" };

function layoutOf(state: CompactionState, node: RawNodeT): DesignNodeT["layout"] {
  const mode = node.layout?.mode;
  const dir = mode === "HORIZONTAL" ? "row" : mode === "VERTICAL" ? "col" : "none";
  const sizingH = SIZING[node.layout?.sizingH ?? "HUG"] ?? "hug";
  const sizingV = SIZING[node.layout?.sizingV ?? "HUG"] ?? "hug";
  const layout: DesignNodeT["layout"] = { dir, sizing: { w: sizingH, h: sizingV } };

  const gap = dimension(state, node.bound.gap, node.layout?.gap ?? 0, node.id);
  if (gap !== undefined) layout.gap = gap;

  const padding = node.layout?.padding;
  if (padding !== undefined && padding.some((p) => p !== 0)) {
    layout.pad = padding.map((value, i) => dimension(state, node.bound.padding?.[i], value, node.id) ?? 0);
  }
  const align = ALIGN[node.layout?.primaryAlign ?? ""];
  if (align !== undefined) layout.align = align;
  const cross = ALIGN[node.layout?.counterAlign ?? ""];
  if (cross === "start" || cross === "center" || cross === "end") layout.crossAlign = cross;
  if (sizingH === "fixed" || sizingV === "fixed") {
    layout.size = {
      ...(sizingH === "fixed" ? { w: node.bbox.w } : {}),
      ...(sizingV === "fixed" ? { h: node.bbox.h } : {}),
    };
  }
  return layout;
}

function radiusValue(state: CompactionState, node: RawNodeT): string | undefined {
  const ref = refOf(state, node.bound.radius);
  if (ref !== null) return ref;
  const radius = node.radius;
  if (radius === undefined) return undefined;
  const parts = typeof radius === "number" ? [radius] : radius;
  if (parts.every((p) => p <= 0)) return undefined;
  const text = [...new Set(parts)].length === 1 ? `${parts[0] as number}px` : parts.map((p) => `${p}px`).join(" ");
  warn(state, "UNBOUND_DIMENSION", node.id, text);
  return `raw:${text}`;
}

function styleOf(state: CompactionState, node: RawNodeT, role: DesignNodeT["role"]): Record<string, string> {
  const style: Record<string, string> = {};
  const fill = node.fills?.[0];
  if (fill?.type === "SOLID" && fill.color !== undefined) {
    style[role === "text" ? "fg" : "bg"] = colorValue(state, node.bound.fill, fill.color, node.id);
  }
  const stroke = node.strokes?.[0];
  if (stroke !== undefined) {
    style.border = colorValue(state, node.bound.stroke, stroke.color, node.id);
    // Stroke width accepts a raw value by contract, so an absent binding does not produce a warning.
    style.borderWidth = refOf(state, node.bound.strokeWeight) ?? `raw:${stroke.weight}px`;
  }
  const radius = radiusValue(state, node);
  if (radius !== undefined) style.radius = radius;
  if (node.opacity !== undefined && node.opacity < 1) {
    const ref = refOf(state, node.bound.opacity);
    style.opacity = ref ?? `raw:${node.opacity}`;
  }
  return style;
}

function textOf(state: CompactionState, node: RawNodeT): DesignNodeT["text"] | undefined {
  if (node.text === undefined) return undefined;
  const styleId = node.bound.textStyle;
  const typo = lookup(state, styleId, state.typoPathOf) ?? undefined;
  // Record actual token-file leaves instead of a compound path that has no emitted CSS variable.
  if (styleId !== undefined) for (const leaf of state.typoLeavesOf.get(styleId) ?? []) state.tokensUsed.add(leaf);
  if (typo === undefined) {
    warn(state, "UNBOUND_TYPO", node.id, node.text.fontFamily);
    return { content: node.text.characters };
  }
  return { content: node.text.characters, typo };
}

/** Convert one visible subtree; a hidden node removes its entire subtree. */
export function compactNode(state: CompactionState, node: RawNodeT): DesignNodeT | null {
  if (!node.visible) return null;
  const role = roleOf(state, node);
  const layout = layoutOf(state, node);
  const children = role === "instance"
    ? []
    : node.children.map((c) => compactNode(state, c)).filter((c): c is DesignNodeT => c !== null);

  if (layout.dir === "none" && children.length >= 2) {
    warn(state, "ABSOLUTE_POSITION", node.id, `${children.length} children without auto layout`);
  }
  // Variant-root property strings such as "Variant=Primary" normalize to the component block.
  const name = state.blockOfRoot.get(node.id) ?? slug(node.name);
  const out: DesignNodeT = { id: node.id, role, name, layout, style: styleOf(state, node, role), children };
  const text = textOf(state, node);
  if (text !== undefined) out.text = text;
  if (role === "icon") out.icon = { name: slug(node.name) };
  if (role === "instance") {
    const main = node.mainComponentId;
    out.instanceOf = (main === undefined ? undefined : state.instanceSlugOf.get(main)) ?? slug(main ?? node.name);
  }
  // Full context preserves raw data; compact context omits transport-oriented detail.
  if (state.level === "full") out.raw = { bbox: node.bbox, type: node.type, extra: node.extra ?? {} };
  return out;
}
