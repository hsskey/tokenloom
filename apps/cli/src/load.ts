import { readFileSync } from "node:fs";
import type { SnapshotT } from "@tokenloom/schema";
import { Snapshot, visiblePaintsWithBound } from "@tokenloom/schema";

export interface LoadResult {
  snapshot: SnapshotT;
  bytesIn: number;
}

/** docs/reference/spec.md section 4.9: Merge component sets by ID and let later snapshots override variables by ID. */
export function loadSnapshots(from: string): LoadResult {
  const paths = from.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  let bytesIn = 0;
  let merged: SnapshotT | undefined;
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    bytesIn += Buffer.byteLength(text, "utf8");
    const raw = parseJson(path, text);
    rejectMixedRenderFields(path, raw);
    dropHiddenPaintsAndBound(raw);
    const next = validate(path, () => Snapshot.parse(raw));
    merged = merged === undefined ? next : merge(merged, next);
  }
  if (merged === undefined) throw new Error("no snapshot path given");
  return { snapshot: merged, bytesIn };
}

/** The render field is the only place a plugin export and a saved Snapshot differ in shape. */
interface RenderProbe {
  componentSets?: { components?: { renderPng?: unknown; renderPngBase64?: unknown }[] }[];
}

/**
 * A plugin export already loads here: it is a Snapshot plus `renderPngBase64`, and Zod drops that
 * unknown key. Nothing reads a render image, so dropping it costs the caller nothing and no response
 * can name a file this process did not write. An input holding `renderPngBase64` and `renderPng` at
 * once belongs to neither format, so refuse it rather than let key-stripping pick a winner in silence.
 */
function rejectMixedRenderFields(path: string, raw: unknown): void {
  const sets = (raw as RenderProbe | null | undefined)?.componentSets;
  const components = (Array.isArray(sets) ? sets : [])
    .flatMap((set) => Array.isArray(set?.components) ? set.components : []);
  const holds = (key: "renderPng" | "renderPngBase64"): boolean =>
    components.some((component) => typeof component?.[key] === "string");
  if (holds("renderPngBase64") && holds("renderPng")) {
    throw new Error(`${path} carries both renderPngBase64 and renderPng; import it with "tokenloom snapshot import" instead`);
  }
}

/** Name the file, because --from accepts a comma-separated list and the reader cannot guess which one failed. */
export function parseJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface SchemaIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Schema validation reports every problem as one JSON array, which reaches stderr as dozens of lines
 * of library internals. Keep the field path and message, which are the parts a user can act on.
 */
export function validate<T>(path: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    const issues = (error as { issues?: SchemaIssue[] }).issues;
    if (issues === undefined) throw error;
    const lines = issues.map((issue) => `  ${issue.path.join(".") || "<root>"}: ${issue.message}`);
    throw new Error(`${path} does not match the expected shape:\n${lines.join("\n")}`);
  }
}

function byId<T extends { id: string }>(left: T[], right: T[]): T[] {
  const map = new Map(left.map((v) => [v.id, v]));
  for (const v of right) map.set(v.id, v);
  return [...map.values()];
}

function merge(left: SnapshotT, right: SnapshotT): SnapshotT {
  return {
    ...left,
    collections: byId(left.collections, right.collections),
    variables: byId(left.variables, right.variables),
    textStyles: byId(left.textStyles, right.textStyles),
    componentSets: byId(left.componentSets, right.componentSets),
    annotations: [...left.annotations, ...right.annotations],
  };
}

/** Raw paint-array keys paired with their binding keys by docs/reference/spec.md section 4.1. */
const PAINT_KEYS = [["fills", "fill"], ["strokes", "stroke"]] as const;

/**
 * Apply docs/reference/spec.md section 4.1 before Snapshot.parse drops paint visibility metadata.
 * Remove the node binding when the original first paint is hidden: adapters derive that binding from that paint.
 * visiblePaintsWithBound preserves the same rule for saved snapshots and adapter input.
 */
function dropHiddenPaintsAndBound(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) dropHiddenPaintsAndBound(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  const bound = node.bound as Record<string, unknown> | undefined;
  for (const [key, boundKey] of PAINT_KEYS) {
    const paints = node[key];
    if (!Array.isArray(paints)) continue;
    const shown = visiblePaintsWithBound(paints as { visible?: unknown }[], [bound?.[boundKey]]);
    if (shown.length === 0) delete node[key];
    else node[key] = shown.map((p) => p.paint);
    if (bound !== null && typeof bound === "object" && shown[0]?.bound === undefined) delete bound[boundKey];
  }
  for (const [key, child] of Object.entries(node)) {
    // extra contains arbitrary adapter metadata rather than schema-defined paint arrays.
    if (key === "extra") continue;
    dropHiddenPaintsAndBound(child);
  }
}
