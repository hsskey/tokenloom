// The expected set comes from committed design context, never the prompt payload, so it is identical
// across raw, compact, annotated, agent, and MCP rows (docs/reference/spec.md 9.5). Markers normalize
// through the public `selectVariant`, the CLI selector grammar, so this module adds no second grammar.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Snapshot, variantSelectorOf, type ComponentSetT, type DesignContextT, type SnapshotT } from "@tokenloom/schema";
import { buildDesignContext, selectVariant } from "@tokenloom/parser";

export interface ExpectedVariants {
  scope: "component" | "variant";
  /** Full context, so a marker for another real variant resolves even under a variant subset. */
  context: DesignContextT;
  selectors: string[];
}

export type ExpectedVariantsErrorCode = "SAMPLE_NOT_FOUND" | "COMPONENT_SET_UNRESOLVED" | "VARIANT_UNRESOLVED";

export class ExpectedVariantsError extends Error {
  constructor(readonly code: ExpectedVariantsErrorCode, message: string) {
    super(message);
    this.name = "ExpectedVariantsError";
  }
}

export interface ExpectedTarget {
  sampleName: string;
  /** Component-set id, mirroring the prompt builder's selection; the first set is used when absent. */
  node?: string;
  /** A base or single-variant selector; its presence narrows the expected set to one candidate. */
  variant?: string;
}

function narrowedSelector(context: DesignContextT): string {
  const component = context.component;
  const variant = component.variants[0];
  return variant === undefined ? variantSelectorOf(component.base.props) : variantSelectorOf(variant.props);
}

function candidateSelectors(context: DesignContextT): string[] {
  const component = context.component;
  return [variantSelectorOf(component.base.props), ...component.variants.map((v) => variantSelectorOf(v.props))].sort();
}

export interface RejectedMarker { code: string; raw: string }

export function resolveVariantMarker(context: DesignContextT, marker: string): string | RejectedMarker {
  const result = selectVariant(context, marker);
  return result.ok ? narrowedSelector(result.context) : { code: result.failure.code, raw: marker.trim() };
}

function resolveComponentSet(repoRoot: string, sampleName: string, node?: string): { snapshot: SnapshotT; set: ComponentSetT } {
  const path = resolve(repoRoot, "samples", sampleName, "snapshot.json");
  if (!existsSync(path)) throw new ExpectedVariantsError("SAMPLE_NOT_FOUND", `no snapshot for ${sampleName}`);
  const parsed = Snapshot.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new ExpectedVariantsError("COMPONENT_SET_UNRESOLVED", `unreadable snapshot for ${sampleName}`);
  const set = node === undefined
    ? parsed.data.componentSets[0]
    : parsed.data.componentSets.find((candidate) => candidate.id === node);
  if (set === undefined) {
    throw new ExpectedVariantsError("COMPONENT_SET_UNRESOLVED", `no component set ${node ?? "0"} in ${sampleName}`);
  }
  return { snapshot: parsed.data, set };
}

export function expectedVariants(repoRoot: string, target: ExpectedTarget): ExpectedVariants {
  const { snapshot, set } = resolveComponentSet(repoRoot, target.sampleName, target.node);
  const built = buildDesignContext(snapshot, { name: set.name, nodeId: target.node });
  if (!built.ok) throw new ExpectedVariantsError("COMPONENT_SET_UNRESOLVED", `${target.sampleName}: ${built.error.kind}`);
  const context = built.context;
  if (target.variant === undefined) {
    return { scope: "component", context, selectors: candidateSelectors(context) };
  }
  const narrowed = selectVariant(context, target.variant);
  if (!narrowed.ok) {
    throw new ExpectedVariantsError("VARIANT_UNRESOLVED", `${narrowed.failure.code}: ${narrowed.failure.detail}`);
  }
  return { scope: "variant", context, selectors: [narrowedSelector(narrowed.context)] };
}

export type ReferenceFailure =
  "NO_SNAPSHOT_COMPONENT" | "AMBIGUOUS_SNAPSHOT_COMPONENT" | "REFERENCE_FILE_MISSING" | "FILENAME_RULE_MISMATCH";

export interface VariantReference {
  selector: string;
  nodeId: string | null;
  renderPng: string | null;
  failure?: ReferenceFailure;
}

// Mirrors the importer's node-id filename rule (apps/cli/src/cmd-snapshot.ts) so a hand-edited path is caught.
function importerRenderPng(nodeId: string): string {
  return `render/${nodeId.replace(/[^A-Za-z0-9_-]+/g, "-")}.png`;
}

export function variantReferences(
  repoRoot: string, target: { sampleName: string; node?: string }, selectors: string[],
): VariantReference[] {
  const { set } = resolveComponentSet(repoRoot, target.sampleName, target.node);
  const bySelector = new Map<string, ComponentSetT["components"]>();
  for (const component of set.components) {
    const key = variantSelectorOf(component.props);
    bySelector.set(key, [...(bySelector.get(key) ?? []), component]);
  }
  return selectors.map((selector) => {
    const matches = bySelector.get(selector) ?? [];
    if (matches.length === 0) return { selector, nodeId: null, renderPng: null, failure: "NO_SNAPSHOT_COMPONENT" };
    if (matches.length > 1) return { selector, nodeId: null, renderPng: null, failure: "AMBIGUOUS_SNAPSHOT_COMPONENT" };
    const component = matches[0] as ComponentSetT["components"][number];
    if (component.renderPng === undefined) return { selector, nodeId: component.id, renderPng: null };
    if (component.renderPng !== importerRenderPng(component.id)) {
      return { selector, nodeId: component.id, renderPng: null, failure: "FILENAME_RULE_MISMATCH" };
    }
    const absolute = resolve(repoRoot, "samples", target.sampleName, component.renderPng);
    if (!existsSync(absolute)) return { selector, nodeId: component.id, renderPng: null, failure: "REFERENCE_FILE_MISSING" };
    return { selector, nodeId: component.id, renderPng: absolute };
  });
}
