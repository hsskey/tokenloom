// Replay captured sample-design REST responses through the adapter without network access.
// Captures preserve Figma's original field shapes beyond what synthetic test data can establish.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot, stableJsonFile, stableStringify, type RawNodeT, type SnapshotT } from "@tokenloom/schema";
import {
  TIER1_CALL_COST, createFileBudget, syncSnapshot,
  type Budget, type BudgetConfig, type HttpResponse, type RestDeps, type RestResult,
} from "../src/index";
import { NOW_MS, headers, httpDeps, scriptedFetch } from "./samples";

const REPO = resolve(import.meta.dirname, "../../../..");
const CAPTURES = join(REPO, "samples/captures/rest");
const CONFIG: BudgetConfig = {};

/** Discover the fileKey from the capture directory instead of embedding a real key in the test. */
function captureDir(fileKey: string): string {
  const keys = readdirSync(CAPTURES);
  if (!keys.includes(fileKey)) throw new Error(`no capture for ${fileKey} in ${keys.join(",")}`);
  const days = readdirSync(join(CAPTURES, fileKey)).sort();
  return join(CAPTURES, fileKey, days[days.length - 1] as string);
}

function readSnapshotFile(rel: string): { snapshot: SnapshotT; bytes: string } {
  const bytes = readFileSync(join(REPO, rel), "utf8");
  return { snapshot: Snapshot.parse(JSON.parse(bytes)), bytes };
}

/** Response that returns the exact captured body because serialization would change the source bytes. */
function rawResponse(dir: string, endpoint: string): HttpResponse {
  const body = readFileSync(join(dir, `${endpoint}.json`), "utf8");
  return { status: 200, headers: headers(), text: async () => body };
}

function newBudget(): Budget {
  const created = createFileBudget(mkdtempSync(join(tmpdir(), "tl-cap-")), "pro", CONFIG, () => NOW_MS);
  if (!created.ok) throw new Error(created.reason);
  return created.budget;
}

function valueOf<T>(res: RestResult<T>): T {
  if (!res.ok) throw new Error(res.failure.detail);
  return res.value;
}

/**
 * Replay three captures in request order.
 * Inject the stored Snapshot `fetchedAt`, the only clock-derived value, so all output bytes must match.
 */
async function replay(rel: string): Promise<{ stored: string; got: SnapshotT; tier1Calls: number }> {
  const { snapshot: stored, bytes } = readSnapshotFile(rel);
  const dir = captureDir(stored.source.fileKey);
  const depth = Number(
    (readdirSync(dir).find((f) => f.startsWith("files-depth")) as string).replace(/\D+/g, ""),
  );
  const { fetch } = scriptedFetch([
    rawResponse(dir, `files-depth${depth}`), rawResponse(dir, "nodes-batch-1"), rawResponse(dir, "comments"),
  ]);
  const { deps: http } = httpDeps(fetch);
  const deps: RestDeps = {
    http: { ...http, nowMs: () => Date.parse(stored.source.fetchedAt) },
    budget: newBudget(), plan: stored.source.plan, discoverDepth: depth,
  };
  const result = valueOf(await syncSnapshot(deps, {
    fileKey: stored.source.fileKey,
    setNames: stored.componentSets.map((s) => s.name),
    expectSets: stored.componentSets.length,
    withComments: true,
  }));
  return { stored: bytes, got: result.snapshot, tier1Calls: result.tier1Calls };
}

function rawNodes(dir: string, endpoint: string): Map<string, Record<string, unknown>> {
  const parsed = JSON.parse(readFileSync(join(dir, `${endpoint}.json`), "utf8")) as {
    nodes?: Record<string, { document: Record<string, unknown> }>;
    document?: Record<string, unknown>;
  };
  const out = new Map<string, Record<string, unknown>>();
  const walk = (n: Record<string, unknown>): void => {
    out.set(n.id as string, n);
    for (const c of (n.children ?? []) as Record<string, unknown>[]) walk(c);
  };
  const roots = parsed.nodes === undefined
    ? [parsed.document as Record<string, unknown>]
    : Object.values(parsed.nodes).map((e) => e.document);
  for (const r of roots) walk(r);
  return out;
}

function allNodes(snapshot: SnapshotT): RawNodeT[] {
  const out: RawNodeT[] = [];
  const walk = (n: RawNodeT): void => { out.push(n); n.children.forEach(walk); };
  for (const set of snapshot.componentSets) for (const c of set.components) walk(c.root);
  return out;
}

describe("real-design-system REST capture replay (docs/reference/spec.md section 4.1)", () => {
  it("reproduces the stored Snapshot byte-for-byte from three captures using two Tier 1 calls", async () => {
    const { stored, got, tier1Calls } = await replay("samples/real-design-system/snapshot.rest.json");

    expect(stableJsonFile(got)).toBe(stored);
    expect(tier1Calls).toBe(TIER1_CALL_COST * 2);
  });

  it("docs/reference/spec.md section 4.1: preserves all 98 pre-export fills as hidden paints in the raw response", () => {
    // Stored source bytes distinguish Figma omissions from mapper filtering without another API call.
    const { snapshot } = readSnapshotFile("samples/real-design-system/snapshot.rest.json");
    const raw = rawNodes(captureDir(snapshot.source.fileKey), "nodes-batch-1");
    const hidden = [...raw.values()].filter((n) => {
      const fills = n.fills as { visible?: boolean }[] | undefined;
      return fills !== undefined && fills.length > 0 && fills.every((f) => f.visible === false);
    });

    expect(hidden.length).toBe(98);
    expect(hidden.every((n) => n.type === "INSTANCE")).toBe(true);
    expect(raw.get("11:11510")?.fills).toEqual([
      { blendMode: "NORMAL", visible: false, type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } },
    ]);
  });

  it("docs/reference/spec.md section 4.1: removes all 98 hidden fills from the mapped Snapshot", async () => {
    const { got } = await replay("samples/real-design-system/snapshot.rest.json");
    const nodes = allNodes(got);

    expect(nodes.length).toBe(299);
    expect(nodes.filter((n) => n.fills !== undefined).length).toBe(85);
    expect(nodes.flatMap((n) => n.fills ?? []).filter((f) => "visible" in f)).toEqual([]);
  });

  it("docs/reference/spec.md section 4.1: preserves componentPropertyDefinitions order in sample-design props", async () => {
    const { got } = await replay("samples/real-design-system/snapshot.rest.json");
    const set = got.componentSets[0];

    expect([set?.id, set?.name]).toEqual(["4185:3778", "Button"]);
    expect(Object.keys(set?.props ?? {})).toEqual(["Variant", "State", "Size"]);
    expect(set?.props.Variant).toEqual(["Primary", "Neutral", "Subtle"]);
    expect(set?.components[0]?.props).toEqual({ Variant: "Primary", State: "Default", Size: "Medium" });
    expect(set?.components[0]?.root.name).toBe("Variant=Primary, State=Default, Size=Medium");
  });

  it("docs/reference/spec.md section 4.1: maps sample-design layout, color, radius, and boundVariables to Snapshot fields", async () => {
    const { got } = await replay("samples/real-design-system/snapshot.rest.json");
    const root = got.componentSets[0]?.components[0]?.root as RawNodeT;

    expect(root.layout).toEqual({
      mode: "HORIZONTAL", gap: 8, padding: [12, 12, 12, 12],
      primaryAlign: "CENTER", counterAlign: "CENTER", sizingH: "FIXED", sizingV: "FIXED",
    });
    expect(root.fills).toEqual([
      { type: "SOLID", color: { r: 0.1725490242242813, g: 0.1725490242242813, b: 0.1725490242242813, a: 1 } },
    ]);
    expect(root.radius).toBe(8);
    expect(root.bound).toEqual({
      fill: "VariableID:3919:36428", stroke: "VariableID:3919:36516",
      gap: "VariableID:9:11259",
      padding: ["VariableID:9:11260", "VariableID:9:11260", "VariableID:9:11260", "VariableID:9:11260"],
      radius: undefined, textStyle: undefined, opacity: undefined,
    });
    // Text nodes carry values in style and bindings in styles.text.
    expect(root.children.map((c) => [c.id, c.type])).toEqual([
      ["4185:3780", "INSTANCE"], ["4185:3781", "TEXT"], ["4185:3782", "INSTANCE"],
    ]);
    const text = root.children[1] as RawNodeT;
    expect(text.bound.textStyle).toBe("56:9001");
    expect(text.text).toEqual({
      characters: "Button", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 16,
    });
  });

  it("docs/reference/spec.md section 4.1: combines text-style names from the file response with node values", async () => {
    const { got } = await replay("samples/real-design-system/snapshot.rest.json");

    expect(got.textStyles).toEqual([
      { id: "56:9001", name: "Single Line/Body Base", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 16 },
    ]);
  });

  it("docs/reference/spec.md section 4.8: emits no annotations when real-design-system node batches contain none", async () => {
    // Only node batches are mapped, matching the plugin's set-root and descendant scope.
    const { snapshot } = readSnapshotFile("samples/real-design-system/snapshot.rest.json");
    const dir = captureDir(snapshot.source.fileKey);
    const annotated = (endpoint: string): string[] =>
      [...rawNodes(dir, endpoint)].filter(([, n]) => n.annotations !== undefined).map(([id]) => id);
    const { got } = await replay("samples/real-design-system/snapshot.rest.json");

    expect(annotated("files-depth4").length).toBe(38);
    expect(annotated("nodes-batch-1")).toEqual([]);
    expect(got.annotations).toEqual([]);
  });

  it("docs/reference/spec.md section 0: leaves collections and variables empty without calling the Variables endpoint", async () => {
    const { got } = await replay("samples/real-design-system/snapshot.rest.json");
    const bound = allNodes(got).filter((n) => n.bound.fill !== undefined);

    expect([got.collections, got.variables]).toEqual([[], []]);
    expect(got.source.plan).toBe("pro");
    // Binding IDs remain so the parser can continue with UNBOUND_* warnings even without values.
    expect(bound.length).toBe(85);
  });
});

describe("real-annotated-theme REST capture replay and Dev Mode annotations (docs/reference/spec.md section 0.1, 4.8)", () => {
  it("reproduces the stored real-annotated-theme Snapshot byte-for-byte from three captures", async () => {
    const { stored, got, tier1Calls } = await replay("samples/real-annotated-theme/snapshot.rest.json");

    expect(stableJsonFile(got)).toBe(stored);
    expect(tier1Calls).toBe(TIER1_CALL_COST * 2);
  });

  it("reads the two measured Pro Dev Mode annotations from REST node labels", () => {
    const { snapshot } = readSnapshotFile("samples/real-annotated-theme/snapshot.rest.json");
    const dir = captureDir(snapshot.source.fileKey);
    // Sort by node ID because the two endpoints traverse nodes in different orders.
    const labels = (endpoint: string): [string, unknown][] =>
      [...rawNodes(dir, endpoint)].filter(([, n]) => n.annotations !== undefined)
        .map(([id, n]): [string, unknown] => [id, n.annotations])
        .sort(([a], [b]) => a.localeCompare(b));

    expect(labels("nodes-batch-1")).toEqual([
      ["1:10", [{ label: "[a11y] 라벨을 시각적으로 숨기지 않는다" }]],
      ["1:13", [{ label: "[behavior] Enter/Space로 활성화" }]],
    ]);
    // Discovery contains the same values; node batches are not the only source response carrying them.
    expect(labels("files-depth4")).toEqual(labels("nodes-batch-1"));
  });

  it("docs/reference/spec.md section 4.8: records read for real-annotated-theme annotationsSupport just like the plugin Snapshot", async () => {
    const plugin = readSnapshotFile("samples/real-annotated-theme/snapshot.json").snapshot;
    const { got } = await replay("samples/real-annotated-theme/snapshot.rest.json");

    expect([got.source.annotationsSupport, plugin.source.annotationsSupport]).toEqual(["read", "read"]);
  });

  it("docs/reference/spec.md section 4.8: matches two node-label annotations to the plugin Snapshot when comments are empty", async () => {
    const { snapshot } = readSnapshotFile("samples/real-annotated-theme/snapshot.rest.json");
    const dir = captureDir(snapshot.source.fileKey);
    const comments = JSON.parse(readFileSync(join(dir, "comments.json"), "utf8")) as { comments: unknown[] };
    const plugin = readSnapshotFile("samples/real-annotated-theme/snapshot.json").snapshot;
    const { got } = await replay("samples/real-annotated-theme/snapshot.rest.json");

    expect(comments.comments).toEqual([]);
    expect(got.annotations).toEqual([
      { nodeId: "1:10", text: "[a11y] 라벨을 시각적으로 숨기지 않는다", source: "devmode" },
      { nodeId: "1:13", text: "[behavior] Enter/Space로 활성화", source: "devmode" },
    ]);
    // The two adapters must emit identical bytes for the same design.
    expect(stableStringify(got.annotations)).toBe(stableStringify(plugin.annotations));
  });
});
