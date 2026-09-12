// Regression for exports under `documentAccess: "dynamic-page"`.
// A 2026-09-03 sample-design export failed when toRawNode read synchronous `mainComponent` from a live INSTANCE.
import { describe, expect, it } from "vitest";
import { buildExport, collectMainIds, toRawNode, type FigmaNode, type LiveRoot } from "../src/export";

const DYNAMIC_PAGE_ERROR =
  "in get_mainComponent: Cannot call with documentAccess: dynamic-page. Use node.getMainComponentAsync instead.";

/** Live plugin INSTANCE whose synchronous getter throws and whose async API is the only read path. */
function liveInstance(id: string, mainId: string | null): FigmaNode {
  const node = {
    id, name: "Icon", type: "INSTANCE",
    absoluteBoundingBox: { x: 0, y: 0, width: 16, height: 16 },
    children: [] as FigmaNode[],
    getMainComponentAsync: (): Promise<{ id: string } | null> =>
      Promise.resolve(mainId === null ? null : { id: mainId }),
  };
  Object.defineProperty(node, "mainComponent", {
    get(): never { throw new Error(DYNAMIC_PAGE_ERROR); },
  });
  return node as unknown as FigmaNode;
}

/** COMPONENT root that returns descendant INSTANCE nodes through findAllWithCriteria. */
function liveComponent(instances: readonly FigmaNode[]): FigmaNode & LiveRoot {
  return {
    id: "1:2", name: "Button", type: "COMPONENT",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    children: instances,
    findAllWithCriteria: (): readonly FigmaNode[] => instances,
  } as unknown as FigmaNode & LiveRoot;
}

function exportOf(root: FigmaNode, mainIds: ReadonlyMap<string, string>): ReturnType<typeof buildExport> {
  return buildExport({
    fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z",
    collections: [], variables: [], textStyles: [], mainIds,
    sets: [{ id: "1:1", name: "Button", props: {}, components: [{ id: "1:2", props: {}, root }] }],
  });
}

describe("dynamic-page safety (docs/reference/spec.md section 4.1)", () => {
  it("exports live INSTANCE nodes and includes mainComponentId", async () => {
    const root = liveComponent([liveInstance("3:4", "9:9")]);
    const built = exportOf(root, await collectMainIds([root]));
    expect(built.componentSets[0]?.components[0]?.root.children[0]?.mainComponentId).toBe("9:9");
  });

  it("uses only getMainComponentAsync without reading synchronous mainComponent", async () => {
    const root = liveComponent([liveInstance("3:4", "9:9"), liveInstance("3:5", "9:8")]);
    expect([...(await collectMainIds([root]))]).toEqual([["3:4", "9:9"], ["3:5", "9:8"]]);
  });

  it("passes through an INSTANCE without mainComponentId when no main component exists", async () => {
    const root = liveComponent([liveInstance("3:4", null)]);
    const built = exportOf(root, await collectMainIds([root]));
    expect(built.componentSets[0]?.components[0]?.root.children[0]?.mainComponentId).toBe(undefined);
  });

  it("returns an empty map for detached test nodes without the INSTANCE lookup API", async () => {
    expect((await collectMainIds([{}])).size).toBe(0);
  });

  it("does not throw when fills or strokes equal the figma.mixed symbol", () => {
    const mixed = Symbol("figma.mixed") as unknown as FigmaNode["fills"];
    const node = { id: "1:9", name: "Label", type: "TEXT", fills: mixed, strokes: mixed } as unknown as FigmaNode;
    const raw = toRawNode(node);
    expect(raw.fills).toBe(undefined);
    expect(raw.strokes).toBe(undefined);
  });
});
