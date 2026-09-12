import type { ComponentSetT, DesignContextT, DesignNodeT, SnapshotT, WarningT } from "@tokenloom/schema";
import { slug, stableStringify } from "@tokenloom/schema";
import { compactNode, makeCompactionState, type ContextLevel } from "./compact";
import { annotationsFor, selectComponentSet, type SelectResult } from "./select";
import { contentHashOf, deltaBetween } from "./delta";
import { baseIndexOf } from "./component-set";

export * from "./compact";
export * from "./select";
export * from "./delta";
export * from "./agent";
export * from "./variant";
export * from "./discover";
export * from "./component-set";

export interface BuildDesignContextOptions {
  name: string;
  nodeId?: string;
  level?: ContextLevel;
  annotations?: boolean;
}

export type BuildDesignContextResult =
  | { ok: true; context: DesignContextT; warnings: WarningT[] }
  | { ok: false; error: Exclude<SelectResult, { ok: true }> };

/** Sort warnings by stable identity so input order cannot change serialized output. */
export function sortWarnings(warnings: WarningT[]): WarningT[] {
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return [...warnings].sort((a, b) => cmp(a.code, b.code) || cmp(a.nodeId, b.nodeId));
}

export function buildDesignContext(
  snapshot: SnapshotT,
  options: BuildDesignContextOptions,
): BuildDesignContextResult {
  const selected = selectComponentSet(snapshot, options.name, options.nodeId);
  if (!selected.ok) return { ok: false, error: selected };
  const set = selected.set;
  const state = makeCompactionState(snapshot, options.level ?? "compact");

  const baseIndex = baseIndexOf(set);
  const trees = set.components.map((c) => compactNode(state, c.root));
  const baseTree = trees[baseIndex];
  if (baseTree === null || baseTree === undefined) {
    return { ok: false, error: { ok: false, kind: "empty", name: options.name } };
  }

  const variants: DesignContextT["component"]["variants"] = [];
  for (let i = 0; i < set.components.length; i += 1) {
    if (i === baseIndex) continue;
    const component = set.components[i] as ComponentSetT["components"][number];
    const tree = trees[i];
    if (tree === null || tree === undefined) continue;
    const delta = deltaBetween(baseTree, tree);
    // A structural mismatch cannot be represented as leaf deltas, so preserve the complete root.
    if (delta === null) {
      state.warnings.push({ code: "VARIANT_STRUCTURE_DIFF", nodeId: component.id, detail: "structure differs from base" });
      variants.push({ props: component.props, root: tree });
    } else {
      variants.push({ props: component.props, delta });
    }
  }

  const baseComponent = set.components[baseIndex] as ComponentSetT["components"][number];
  const context: DesignContextT = {
    version: 1,
    source: {
      fileKey: snapshot.source.fileKey,
      nodeId: set.id,
      fileVersion: snapshot.source.fileVersion,
      fetchedAt: snapshot.source.fetchedAt,
      contentHash: contentHashOf(set),
    },
    component: {
      name: set.name,
      block: slug(set.name),
      props: set.props,
      base: { props: baseComponent.props, root: baseTree },
      variants,
    },
    tokensUsed: [...state.tokensUsed].sort(),
    annotations: options.annotations === true ? annotationsFor(snapshot, set) : [],
    warnings: sortWarnings(state.warnings),
  };
  return { ok: true, context, warnings: context.warnings };
}

/** Uses the same two-space indentation as serialized design context and `bench/context.bench.ts`. */
export function componentSetBytes(set: ComponentSetT): number {
  return Buffer.byteLength(serializeSet(set), "utf8");
}

function serializeSet(set: ComponentSetT): string {
  return stableStringify(set);
}

export type { DesignNodeT };
