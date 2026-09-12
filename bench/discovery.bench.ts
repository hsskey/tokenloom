// Discovery envelope size and latency on a generated snapshot that exceeds the default item limit.
// docs/reference/verification.md section 12.7 owns the thresholds this record feeds.
// Package sources are imported by path rather than by `@tokenloom/*` specifier: this module is
// consumed by a test outside the workspace packages, and the repository root has no workspace
// link for those names. `tsconfig.base.json` maps the specifiers to these same files.
import { stableJsonFile, type AgentDiscoveryT, type RawNodeT, type SnapshotT } from "../packages/schema/src/index";
import { discoverComponentSets } from "../packages/parser/src/index";
import { rawPercentile, timed, type BenchRecord } from "./util";

/**
 * Twenty-four long names keep the workload above the item limit while escaped and multibyte text
 * exercise the public UTF-8 byte limit. The repeated name makes discovery carry long node ids too.
 */
const NAME_DETAIL = " — 상태, \"강조\" \\ 경로".repeat(12);
export const DISCOVERY_NAMES = [
  "Tooltip", "Button", "Button", "Avatar", "Checkbox", "DatePicker",
  "Accordion", "Badge", "Breadcrumb", "Card", "Toast", "Dialog",
  "Divider", "Drawer", "EmptyState", "FileUpload", "IconButton", "Input",
  "Menu", "Pagination", "ProgressBar", "RadioGroup", "Select", "Table",
].map((name) => `${name}${NAME_DETAIL}`);

function node(id: string): RawNodeT {
  return {
    id, name: id, type: "COMPONENT", visible: true,
    bbox: { x: 0, y: 0, w: 40, h: 24 }, bound: {}, children: [],
  };
}

/**
 * Uses no randomness, so equal names always produce equal bytes and the record stays comparable
 * across runs and hosts. The component count comes from the name rather than the position, so a
 * reordered name list produces byte-identical discovery output and the sort stays measurable.
 */
export function discoverySnapshot(names: string[]): SnapshotT {
  const occurrences = new Map<string, number>();
  return {
    version: 1,
    source: {
      kind: "sample", plan: "unknown", fileKey: "DISCOVERY",
      fileVersion: "discovery-1", fetchedAt: "2026-01-01T00:00:00Z",
    },
    collections: [],
    variables: [],
    textStyles: [],
    annotations: [],
    componentSets: names.map((name) => {
      const occurrence = occurrences.get(name) ?? 0;
      occurrences.set(name, occurrence + 1);
      const id = `discovery:${encodeURIComponent(name)}:${String(occurrence)}`;
      return {
        id,
        name,
        props: { size: ["sm", "md"] },
        components: Array.from({ length: 1 + (name.length % 5) }, (_unused, ordinal) => ({
          id: `${id}:${String(ordinal)}`,
          props: { size: ordinal === 0 ? "sm" : "md" },
          root: node(`${id}:${String(ordinal)}`),
        })),
      };
    }),
  };
}

/** The measured subject is the full serialized Agent discovery envelope, `next` included. */
export function discoveryBytes(payload: AgentDiscoveryT): number {
  return Buffer.byteLength(stableJsonFile(payload), "utf8");
}

/** `truncated` is recorded as 1 or 0 because a benchmark record field is a number or a string. */
export function discoveryRecord(payload: AgentDiscoveryT, componentSets: number, times: number[]): BenchRecord {
  return {
    name: "context.discovery",
    bytes: discoveryBytes(payload),
    componentSets,
    count: payload.count,
    p50: rawPercentile(times, 50),
    p99: rawPercentile(times, 99),
    returned: payload.returned,
    truncated: payload.truncated ? 1 : 0,
  };
}

/** Reading a field of every call keeps the optimizer from removing the call being measured. */
let consumed = 0;

export function run(): BenchRecord {
  const snapshot = discoverySnapshot(DISCOVERY_NAMES);
  const payload = discoverComponentSets(snapshot);
  const times = timed(5, 30, () => { consumed += discoverComponentSets(snapshot).returned; });
  if (consumed === 0) throw new Error("discovery bench: no discovery was measured");
  return discoveryRecord(payload, snapshot.componentSets.length, times);
}
