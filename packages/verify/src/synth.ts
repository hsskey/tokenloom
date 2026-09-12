// Synthetic snapshot generator used as scale-benchmark and probe input (docs/reference/verification.md
// section 7). It uses no randomness, so an equal nodeCount always produces equal bytes and
// measurements stay comparable across runs and hosts.

interface SynthNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  bbox: { x: number; y: number; w: number; h: number };
  layout: { mode: "HORIZONTAL" | "VERTICAL"; gap: number; padding: [number, number, number, number]; sizingH: "HUG"; sizingV: "HUG" };
  fills: { type: "SOLID"; color: { r: number; g: number; b: number; a: number } }[];
  bound: { fill?: string; gap?: string };
  children: SynthNode[];
}

const BRANCH = 4;

function tree(count: number): SynthNode {
  const nodes: SynthNode[] = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push({
      id: `s:${i}`,
      name: `Node${i}`,
      type: i % 7 === 3 ? "TEXT" : "FRAME",
      visible: true,
      bbox: { x: i % 100, y: Math.floor(i / 100), w: 40 + (i % 9), h: 24 },
      layout: { mode: i % 2 === 0 ? "HORIZONTAL" : "VERTICAL", gap: 8, padding: [8, 16, 8, 16], sizingH: "HUG", sizingV: "HUG" },
      fills: [{ type: "SOLID", color: { r: (i % 10) / 10, g: 0.5, b: 0.9, a: 1 } }],
      bound: i % 3 === 0 ? { fill: "sv1", gap: "sv2" } : {},
      children: [],
    });
  }
  for (let i = 1; i < count; i += 1) {
    const parent = nodes[Math.floor((i - 1) / BRANCH)];
    const child = nodes[i];
    if (parent !== undefined && child !== undefined) parent.children.push(child);
  }
  const root = nodes[0];
  if (root === undefined) throw new Error("synth: nodeCount must be >= 1");
  root.type = "COMPONENT";
  root.name = "Synth";
  return root;
}

/** Snapshot with nodeCount nodes and two variants for base-plus-delta measurement. */
export function synthSnapshot(nodeCount: number): unknown {
  const base = tree(nodeCount);
  const variant = JSON.parse(JSON.stringify(base)) as SynthNode;
  variant.id = "s:v";
  variant.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }];
  return {
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "SYNTH", fileVersion: "synth-1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [{ id: "sc", name: "Synth", modes: [{ id: "sm", name: "Value" }], defaultModeId: "sm" }],
    variables: [
      { id: "sv1", name: "color/synth/bg", collectionId: "sc", type: "COLOR", valuesByMode: { sm: { r: 0.1, g: 0.2, b: 0.3, a: 1 } } },
      { id: "sv2", name: "space/synth", collectionId: "sc", type: "FLOAT", valuesByMode: { sm: 8 } },
    ],
    textStyles: [],
    componentSets: [{
      id: "s:0",
      name: "Synth",
      props: { state: ["a", "b"] },
      components: [
        { id: "s:0", props: { state: "a" }, root: base },
        { id: "s:v", props: { state: "b" }, root: variant },
      ],
    }],
    annotations: [],
  };
}
