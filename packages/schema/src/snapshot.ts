import { z } from "zod";

export const VarId = z.string();
export const NodeId = z.string();
export const Color = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() }); // 0~1

export const VarValue = z.union([Color, z.number(), z.string(), z.boolean(), z.object({ alias: VarId })]);

export const Variable = z.object({
  id: VarId,
  name: z.string(),                        // Original Figma name, for example "color/button/primary/bg".
  collectionId: z.string(),
  type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]),
  valuesByMode: z.record(z.string(), VarValue),
});

export const Collection = z.object({
  id: z.string(),
  name: z.string(),
  modes: z.array(z.object({ id: z.string(), name: z.string() })),
  defaultModeId: z.string(),
});

export const TextStyle = z.object({
  id: z.string(),
  name: z.string(),                        // "label/md"
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  lineHeight: z.number(),                  // px
  letterSpacing: z.number().optional(),
});

export interface RawNodeT {
  id: string;
  name: string;
  type: string;                            // Original Figma node type; unknown values are allowed.
  visible: boolean;
  bbox: { x: number; y: number; w: number; h: number };
  layout?: {
    mode: "HORIZONTAL" | "VERTICAL" | "NONE";
    gap?: number;
    padding?: [number, number, number, number];   // top, right, bottom, left
    primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
    counterAlign?: "MIN" | "CENTER" | "MAX";
    sizingH?: "HUG" | "FILL" | "FIXED";
    sizingV?: "HUG" | "FILL" | "FIXED";
  };
  fills?: { type: "SOLID" | "IMAGE" | "GRADIENT" | "OTHER"; color?: { r: number; g: number; b: number; a: number } }[];
  strokes?: { color: { r: number; g: number; b: number; a: number }; weight: number }[];
  radius?: number | [number, number, number, number];
  opacity?: number;
  text?: { characters: string; fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  bound: {
    fill?: string; stroke?: string; strokeWeight?: string; gap?: string;
    padding?: [string?, string?, string?, string?];
    radius?: string; textStyle?: string; opacity?: string;
  };
  mainComponentId?: string;
  children: RawNodeT[];
  extra?: Record<string, unknown>;          // Additional fields preserved by the adapter.
}
export const RawNode: z.ZodType<RawNodeT> = z.lazy(() => z.object({
  id: NodeId, name: z.string(), type: z.string(), visible: z.boolean(),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  layout: z.object({
    mode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]),
    gap: z.number().optional(),
    padding: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    primaryAlign: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional(),
    counterAlign: z.enum(["MIN", "CENTER", "MAX"]).optional(),
    sizingH: z.enum(["HUG", "FILL", "FIXED"]).optional(),
    sizingV: z.enum(["HUG", "FILL", "FIXED"]).optional(),
  }).optional(),
  fills: z.array(z.object({ type: z.enum(["SOLID", "IMAGE", "GRADIENT", "OTHER"]), color: Color.optional() })).optional(),
  strokes: z.array(z.object({ color: Color, weight: z.number() })).optional(),
  radius: z.union([z.number(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).optional(),
  opacity: z.number().optional(),
  text: z.object({
    characters: z.string(), fontFamily: z.string(), fontSize: z.number(),
    fontWeight: z.number(), lineHeight: z.number(),
  }).optional(),
  bound: z.object({
    fill: z.string().optional(), stroke: z.string().optional(), strokeWeight: z.string().optional(), gap: z.string().optional(),
    padding: z.tuple([z.string().optional(), z.string().optional(), z.string().optional(), z.string().optional()]).optional(),
    radius: z.string().optional(), textStyle: z.string().optional(), opacity: z.string().optional(),
  }),
  mainComponentId: z.string().optional(),
  children: z.array(RawNode),
  extra: z.record(z.string(), z.unknown()).optional(),
}));

export const ComponentSet = z.object({
  id: NodeId,
  name: z.string(),
  props: z.record(z.string(), z.array(z.string())),   // { variant: ["primary","secondary"], size: ["md"] }
  components: z.array(z.object({
    id: NodeId,
    props: z.record(z.string(), z.string()),
    root: RawNode,
    renderPng: z.string().optional(),      // Path relative to samples/<name>/render/<id>.png.
  })),
  // REST discovery stores the page name chain in `parents`. Snapshot comparison ignores this key
  // because only some input sources provide it.
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const Annotation = z.object({
  nodeId: NodeId,
  text: z.string(),
  author: z.string().optional(),
  // `fixture` is the pre-rename spelling of `sample` in snapshots already on disk; accept and normalize it.
  source: z.enum(["devmode", "comment", "sample", "fixture"])
    .transform((source) => source === "fixture" ? "sample" as const : source),
});

export const Snapshot = z.object({
  version: z.literal(1),
  source: z.object({
    // `fixture` is the pre-rename spelling of `sample` in snapshots already on disk; accept and normalize it.
    kind: z.enum(["rest", "plugin", "sample", "fixture"])
      .transform((kind) => kind === "fixture" ? "sample" as const : kind),
    plan: z.enum(["starter", "pro", "org", "enterprise", "unknown"]),
    fileKey: z.string(),
    fileVersion: z.string(),
    fetchedAt: z.string(),
    apiVersion: z.string().optional(),
    // Build stamp of the exporter bundle. Optional so snapshots from bundles that predate the stamp
    // still parse; only `snapshot import --expect-exporter <sha>` requires it.
    exporter: z.object({ sha: z.string(), builtAt: z.string() }).optional(),
    // Whether the export runtime could read node annotations at all, not how many it found.
    // Optional for synthetic test data and for snapshots taken before adapters recorded it.
    annotationsSupport: z.enum(["read", "unsupported"]).optional(),
  }),
  collections: z.array(Collection),
  variables: z.array(Variable),
  textStyles: z.array(TextStyle),
  componentSets: z.array(ComponentSet),
  annotations: z.array(Annotation),
});
export type SnapshotT = z.infer<typeof Snapshot>;

export type VariableT = z.infer<typeof Variable>;
export type CollectionT = z.infer<typeof Collection>;
export type TextStyleT = z.infer<typeof TextStyle>;
export type ComponentSetT = z.infer<typeof ComponentSet>;
export type AnnotationT = z.infer<typeof Annotation>;
export type ColorT = z.infer<typeof Color>;

/**
 * Plugin export format: a Snapshot with `renderPngBase64` attached.
 * `tokenloom snapshot import` writes the base64 data to a file and replaces it with a `renderPng` path.
 * Parsing directly as Snapshot would let Zod strip the base64 field and leave render/ empty.
 */
export const PluginComponent = z.object({
  id: NodeId,
  props: z.record(z.string(), z.string()),
  root: RawNode,
  renderPngBase64: z.string().optional(),
});

export const PluginComponentSet = ComponentSet.omit({ components: true }).extend({
  components: z.array(PluginComponent),
});

export const PluginExport = Snapshot.omit({ componentSets: true }).extend({
  componentSets: z.array(PluginComponentSet),
  /** Page that produced this fragment. `--from a,b` merges page fragments. */
  page: z.object({ id: z.string(), name: z.string() }).optional(),
});
export type PluginExportT = z.infer<typeof PluginExport>;
export type PluginComponentSetT = z.infer<typeof PluginComponentSet>;

/**
 * Adapters drop fills and strokes with `visible: false` before writing a Snapshot, so `bound.fill`
 * and `bound.stroke` refer to the first paint that survives the filter.
 * `bound[i]` belongs to `paints[i]`, and returning the pairs together stops a later filter or map
 * from misaligning them.
 * Input is Figma paints or raw JSON from a stored snapshot; parsed Snapshot paints have no
 * `visible` field and never reach here.
 * The plugin exporter repeats this operation rather than adding Zod to its bundle.
 */
export function visiblePaintsWithBound<T extends { visible?: unknown }, B>(
  paints: readonly T[],
  bound: readonly (B | undefined)[],
): { paint: T; bound: B | undefined }[] {
  return paints.flatMap((paint, i) => (paint?.visible === false ? [] : [{ paint, bound: bound[i] }]));
}
