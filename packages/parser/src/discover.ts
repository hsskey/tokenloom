import { stableJsonFile } from "@tokenloom/schema";
import type { AgentDiscoveryItemT, AgentDiscoveryT, AgentErrorT, ComponentSetT, SnapshotT } from "@tokenloom/schema";
import { visibleVariantCountOf } from "./component-set";
import type { SelectResult } from "./select";
import type { VariantFailure } from "./variant";

/** docs/reference/verification.md section 12.7 owns these bounds; the constants only keep them in one place. */
export const DISCOVERY_LIMIT = 20;
export const DISCOVERY_BYTES_LIMIT = 4096;

const AGENT_JSON = "--from <snapshot> --view agent --json";
const LIST = `context ${AGENT_JSON}`;
const LOOKUP = `context ${AGENT_JSON} -- <name>`;
const NARROW = `context --match <text> ${AGENT_JSON}`;
const BY_NODE = `context --node=<id> ${AGENT_JSON} -- <name>`;
const RETRY_VARIANT = `context --variant=<selector> ${AGENT_JSON} -- <name>`;

export type AgentFailure = Exclude<SelectResult, { ok: true }> | VariantFailure;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Names carried by more than one component set, so an item can say which set it means. */
function ambiguousNames(snapshot: SnapshotT): Set<string> {
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const set of snapshot.componentSets) {
    if (seen.has(set.name)) ambiguous.add(set.name);
    seen.add(set.name);
  }
  return ambiguous;
}

function itemOf(set: ComponentSetT, ambiguous: boolean): AgentDiscoveryItemT {
  const variants = visibleVariantCountOf(set);
  return ambiguous ? { id: set.id, name: set.name, variants } : { name: set.name, variants };
}

function discoveryNext(count: number, truncated: boolean): string[] {
  if (count === 0) return [LIST];
  return truncated ? [LOOKUP, NARROW] : [LOOKUP];
}

function discoveryOf(components: AgentDiscoveryItemT[], count: number): AgentDiscoveryT {
  const truncated = count > components.length;
  return {
    components,
    count,
    next: discoveryNext(count, truncated),
    returned: components.length,
    truncated,
  };
}

function boundedComponents(matches: AgentDiscoveryItemT[]): AgentDiscoveryItemT[] {
  const limited = matches.slice(0, DISCOVERY_LIMIT);
  if (limited.length === matches.length) {
    const completeBytes = Buffer.byteLength(stableJsonFile(discoveryOf(limited, matches.length)), "utf8");
    if (completeBytes <= DISCOVERY_BYTES_LIMIT) return limited;
  }

  let components: AgentDiscoveryItemT[] = [];
  for (const item of limited) {
    const candidate = [...components, item];
    const bytes = Buffer.byteLength(stableJsonFile(discoveryOf(candidate, matches.length)), "utf8");
    if (bytes > DISCOVERY_BYTES_LIMIT) break;
    components = candidate;
  }
  return components;
}

/**
 * List what a snapshot offers when the caller has no component name (docs/reference/spec.md rule A07).
 * Pure: it reads `componentSets` only and builds no design context, so the cost follows the number of
 * sets rather than their contents. Ambiguity is decided over the whole snapshot so `--match` cannot
 * change which fields an item carries.
 */
export function discoverComponentSets(snapshot: SnapshotT, match?: string): AgentDiscoveryT {
  const needle = match?.toLowerCase();
  const ambiguous = ambiguousNames(snapshot);
  const matches = snapshot.componentSets
    .filter((set) => needle === undefined || set.name.toLowerCase().includes(needle))
    .map((set) => itemOf(set, ambiguous.has(set.name)))
    .sort((a, b) =>
      compare(a.name, b.name) || compare(a.id ?? "", b.id ?? "") || a.variants - b.variants);
  return discoveryOf(boundedComponents(matches), matches.length);
}

/**
 * Render a selection or selector failure as the Agent JSON body (docs/reference/spec.md rule A08).
 * `detail` and `candidates` carry the real values; `next` stays a template.
 */
export function agentError(failure: AgentFailure): AgentErrorT {
  if ("code" in failure) return { error: failure, next: [RETRY_VARIANT] };
  if (failure.kind === "collision") {
    const counts = new Map<string, number>();
    for (const id of failure.candidates) counts.set(id, (counts.get(id) ?? 0) + 1);
    const hasUniqueId = [...counts.values()].some((count) => count === 1);
    const duplicateId = [...counts].find(([, count]) => count > 1)?.[0];
    const requiresCorrectedSnapshot = duplicateId !== undefined && !hasUniqueId;
    const detail = requiresCorrectedSnapshot
      ? `"${failure.name}" matches ${failure.candidates.length} component sets `
        + `with duplicate node id "${duplicateId}"; use a corrected snapshot`
      : `"${failure.name}" matches ${failure.candidates.length} component sets`;
    return {
      error: { candidates: failure.candidates, code: "NAME_COLLISION", detail },
      next: requiresCorrectedSnapshot ? [LIST] : [BY_NODE],
    };
  }
  if (failure.kind === "empty") {
    return { error: { code: "COMPONENT_SET_EMPTY", detail: `"${failure.name}" has no components` }, next: [LIST] };
  }
  return { error: { code: "COMPONENT_NOT_FOUND", detail: `component set "${failure.name}" not found` }, next: [LIST] };
}
