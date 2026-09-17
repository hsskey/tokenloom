// The expected set comes from committed design context, never the prompt payload, so it is identical
// across raw, compact, annotated, agent, and MCP rows (docs/reference/spec.md 9.5). Markers normalize
// through the public `selectVariant`, the CLI selector grammar, so this module adds no second grammar.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Snapshot, variantSelectorOf, type DesignContextT } from "@tokenloom/schema";
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

export function expectedVariants(repoRoot: string, target: ExpectedTarget): ExpectedVariants {
  const path = resolve(repoRoot, "samples", target.sampleName, "snapshot.json");
  if (!existsSync(path)) throw new ExpectedVariantsError("SAMPLE_NOT_FOUND", `no snapshot for ${target.sampleName}`);
  const parsed = Snapshot.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new ExpectedVariantsError("COMPONENT_SET_UNRESOLVED", `unreadable snapshot for ${target.sampleName}`);
  const snapshot = parsed.data;
  const set = target.node === undefined
    ? snapshot.componentSets[0]
    : snapshot.componentSets.find((candidate) => candidate.id === target.node);
  if (set === undefined) {
    throw new ExpectedVariantsError("COMPONENT_SET_UNRESOLVED", `no component set ${target.node ?? "0"} in ${target.sampleName}`);
  }
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
