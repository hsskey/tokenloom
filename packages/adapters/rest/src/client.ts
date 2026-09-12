// docs/reference/spec.md section 0.1: one sync uses one discovery call plus one node batch, totaling two Tier 1 calls.
// Batches run sequentially for one-request concurrency, and URLs never request geometry: it expands
// responses sharply and the forbidden-pattern gate rejects it.
import { Snapshot, type ComponentSetT, type SnapshotT } from "@tokenloom/schema";
import type { GetCommentsResponse, GetFileNodesResponse, GetFileResponse } from "@figma/rest-api-spec";
import { TIER1_CALL_COST, type Budget } from "./budget-policy";
import { getJson, type HttpDeps, type ResponseHeaders } from "./http";
import {
  buildSnapshot, collectTextStyles, discoverSets, toAnnotations, toComponentSet, toDevmodeAnnotations, type NodeView,
} from "./map";
import { err, ok, type RestResult } from "./result";

export const API_BASE = "https://api.figma.com";
/** docs/reference/spec.md section 0.1: `nodes?ids=` batches fifty IDs so a normal sync finishes in two Tier 1 calls. */
export const BATCH_SIZE = 50;

export interface RestDeps {
  http: HttpDeps;
  budget: Budget;
  plan: SnapshotT["source"]["plan"];
  /** Discovery depth from `tokenloom.config.ts`, rather than a code constant. */
  discoverDepth: number;
  baseUrl?: string;
}

export interface SyncOptions {
  fileKey: string;
  /** Optional component-set name; absence selects every set in the file. */
  setNames?: string[];
  /** Whether to fetch Tier 2 comments. Dev Mode annotations come from node batches and do not depend on this. */
  withComments?: boolean;
  /**
   * Expected set count. A mismatch stops before node batching to avoid spending Tier 1 budget on the wrong file.
   */
  expectSets?: number;
  /**
   * One raw response labeled by endpoint, such as `files-depth4`, `nodes-batch-1`, or `comments`.
   * Preserving raw bytes avoids another budgeted call when checking whether a field existed before normalization.
   * The CLI writes files, and headers accompany bodies because rate-limit data appears only in headers.
   */
  onRaw?: (endpoint: string, body: string, headers: ResponseHeaders) => void;
}

export interface SyncResult {
  snapshot: SnapshotT;
  /** Tier 1 calls used by this sync, including failed calls. */
  tier1Calls: number;
  /** Measured discovery-response bytes used by size warnings and status records. */
  discoveryBytes: number;
  /** Number of COMPONENT_SET nodes found by discovery. */
  setsFound: number;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function base(deps: RestDeps): string {
  return deps.baseUrl ?? API_BASE;
}

/**
 * Discovery depth is configured because sets nested in sections or frames may be absent from shallow responses.
 */
export function discoveryUrl(deps: RestDeps, fileKey: string): string {
  return `${base(deps)}/v1/files/${encodeURIComponent(fileKey)}?depth=${deps.discoverDepth}`;
}

export function nodesUrl(deps: RestDeps, fileKey: string, ids: string[]): string {
  return `${base(deps)}/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids.map(encodeURIComponent).join(",")}`;
}

export function commentsUrl(deps: RestDeps, fileKey: string): string {
  return `${base(deps)}/v1/files/${encodeURIComponent(fileKey)}/comments`;
}

/**
 * This adapter calls only the three endpoints above and intentionally has no Variables URL builder.
 * Variables REST returns 403 on Starter and the docs/reference/spec.md section 0 matrix forbids it; plugin exports supply values.
 */

/** Raw-response path: `samples/captures/rest/<fileKey>/<utc>/<endpoint>.json`. */
export function restCapturePath(fileKey: string, utcDate: string, endpoint: string): string {
  const safe = (v: string): string => v.replace(/[^A-Za-z0-9_.-]+/g, "-");
  return `samples/captures/rest/${safe(fileKey)}/${safe(utcDate)}/${safe(endpoint)}.json`;
}

export async function syncSnapshot(deps: RestDeps, options: SyncOptions): Promise<RestResult<SyncResult>> {
  let tier1Calls = 0;
  // Charge before each physical call, including retries.
  const tier1 = (): ReturnType<Budget["spend"]> => {
    const failure = deps.budget.spend("tier1", TIER1_CALL_COST);
    if (failure === null) tier1Calls += 1;
    return failure;
  };
  const free = (): null => null;

  let discoveryBytes = 0;
  const file = await getJson<GetFileResponse>(
    deps.http, discoveryUrl(deps, options.fileKey), tier1,
    (body, headers) => {
      discoveryBytes = Buffer.byteLength(body, "utf8");
      options.onRaw?.(`files-depth${deps.discoverDepth}`, body, headers);
    },
  );
  if (!file.ok) return err(file.failure);

  const found = discoverSets(file.value, options.setNames);
  if (options.expectSets !== undefined && found.length !== options.expectSets) {
    // A count mismatch stops after one discovery charge, before irreversible batch spending.
    return err({
      kind: "discovery-count",
      found: found.length,
      expected: options.expectSets,
      // Preserve measured bytes even when stopping so the charged discovery still provides size evidence.
      bytes: discoveryBytes,
      detail: `discovery found ${found.length} component sets, expected ${options.expectSets}`,
    });
  }
  const parentsOf = new Map(found.map((set) => [set.id, set.parents]));
  const ids = found.map((set) => set.id);
  const sets: ComponentSetT[] = [];
  // Dev Mode annotations arrive with node batches, so collect set documents and read them together.
  const roots: NodeView[] = [];
  let batchNo = 0;
  for (const batch of chunk(ids, BATCH_SIZE)) {
    batchNo += 1;
    const label = `nodes-batch-${batchNo}`;
    const res = await getJson<GetFileNodesResponse>(
      deps.http, nodesUrl(deps, options.fileKey, batch), tier1,
      (body, headers) => { options.onRaw?.(label, body, headers); },
    );
    if (!res.ok) return err(res.failure);
    for (const id of batch) {
      const entry = res.value.nodes[id];
      if (entry === undefined) continue;
      const root = entry.document as NodeView;
      roots.push(root);
      const set = toComponentSet(root);
      // Only discovery provides parent chains; node batches contain the set without ancestors.
      if (set !== null) sets.push({ ...set, extra: { parents: parentsOf.get(id) ?? [] } });
    }
  }

  // Dev Mode node annotations are primary; comments provide the free-plan fallback (docs/reference/spec.md section 0).
  const annotations: SnapshotT["annotations"] = toDevmodeAnnotations(roots);
  if (options.withComments === true) {
    const res = await getJson<GetCommentsResponse>(
      deps.http, commentsUrl(deps, options.fileKey), free,
      (body, headers) => { options.onRaw?.("comments", body, headers); },
    );
    if (!res.ok) return err(res.failure);
    annotations.push(...toAnnotations(res.value.comments));
  }

  const snapshot = buildSnapshot({
    fileKey: options.fileKey,
    fileVersion: file.value.version,
    fetchedAt: new Date(deps.http.nowMs()).toISOString(),
    plan: deps.plan,
    componentSets: sets,
    textStyles: collectTextStyles(sets, file.value.styles),
    annotations,
  });
  // A thrown parse error indicates a Figma response-schema change, which is fatal rather than retryable.
  return ok({ snapshot: Snapshot.parse(snapshot), tier1Calls, discoveryBytes, setsFound: found.length });
}
