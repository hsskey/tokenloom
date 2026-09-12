import type { AnnotationT, ComponentSetT, RawNodeT, SnapshotT } from "@tokenloom/schema";

export type SelectResult =
  | { ok: true; set: ComponentSetT }
  | { ok: false; kind: "not-found"; name: string }
  | { ok: false; kind: "collision"; name: string; candidates: string[] }
  | { ok: false; kind: "empty"; name: string };

export function selectComponentSet(snapshot: SnapshotT, name: string, nodeId?: string): SelectResult {
  if (nodeId !== undefined) {
    const byId = snapshot.componentSets.filter((set) => set.name === name && set.id === nodeId);
    if (byId.length === 0) return { ok: false, kind: "not-found", name: nodeId };
    if (byId.length > 1) {
      return { ok: false, kind: "collision", name, candidates: byId.map((set) => set.id).sort() };
    }
    const set = byId[0] as ComponentSetT;
    return set.components.length === 0 ? { ok: false, kind: "empty", name: nodeId } : { ok: true, set };
  }
  const matches = snapshot.componentSets.filter((s) => s.name === name);
  if (matches.length === 0) return { ok: false, kind: "not-found", name };
  if (matches.length > 1) {
    return { ok: false, kind: "collision", name, candidates: matches.map((set) => set.id).sort() };
  }
  const set = matches[0] as ComponentSetT;
  return set.components.length === 0 ? { ok: false, kind: "empty", name } : { ok: true, set };
}

const TAGS = ["intent", "a11y", "behavior"] as const;
export type AnnotationKind = (typeof TAGS)[number] | "note";

export interface DesignAnnotation {
  nodeId: string;
  kind: AnnotationKind;
  text: string;
}

/** Classify only leading `[intent]`, `[a11y]`, and `[behavior]` tags without interpreting the text. */
export function classify(annotation: AnnotationT): DesignAnnotation {
  const match = /^\[(\w+)\]\s*/.exec(annotation.text);
  const tag = match?.[1];
  const kind = TAGS.find((t) => t === tag) ?? "note";
  const text = match !== null && kind !== "note" ? annotation.text.slice(match[0].length) : annotation.text;
  return { nodeId: annotation.nodeId, kind, text };
}

function collectIds(node: RawNodeT, into: Set<string>): void {
  into.add(node.id);
  for (const child of node.children) collectIds(child, into);
}

/** Return annotations owned by the component set, including roots, sorted by `(nodeId, text)`. */
export function annotationsFor(snapshot: SnapshotT, set: ComponentSetT): DesignAnnotation[] {
  const ids = new Set<string>([set.id]);
  for (const component of set.components) collectIds(component.root, ids);
  return snapshot.annotations
    .filter((a) => ids.has(a.nodeId))
    .map(classify)
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}
