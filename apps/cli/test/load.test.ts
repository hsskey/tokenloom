import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnapshots } from "../src/load";

/** Reapply docs/reference/spec.md section 4.1 when saved snapshots still contain hidden paints. */
function write(fills: unknown, strokes: unknown, extra?: unknown, bound: unknown = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "tokenloom-load-"));
  const path = join(dir, "snapshot.json");
  writeFileSync(path, JSON.stringify({
    version: 1,
    source: { kind: "plugin", plan: "starter", fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: [{
      id: "1:1", name: "Card", props: { tone: ["a"] },
      components: [{
        id: "1:2", props: { tone: "a" },
        root: {
          id: "1:3", name: "Root", type: "FRAME", visible: true,
          bbox: { x: 0, y: 0, w: 10, h: 10 }, bound, children: [],
          fills, strokes, extra,
        },
      }],
    }],
  }));
  return path;
}

const HIDDEN_FIRST = [
  { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: false },
  { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } },
];

describe("Snapshot loader (docs/reference/spec.md section 4.1)", () => {
  it("docs/reference/spec.md section 4.1: remove a hidden first fill while preserving the remaining order", () => {
    const root = loadSnapshots(write(HIDDEN_FIRST, undefined)).snapshot.componentSets[0]?.components[0]?.root;
    expect(root?.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]);
  });

  it("docs/reference/spec.md section 4.1: omit fills and strokes when every paint is hidden", () => {
    const hiddenStroke = [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2, visible: false }];
    const root = loadSnapshots(write([HIDDEN_FIRST[0]], hiddenStroke)).snapshot.componentSets[0]?.components[0]?.root;
    expect(root?.fills).toBe(undefined);
    expect(root?.strokes).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: remove bound.fill when the original first fill is hidden", () => {
    // The saved binding came from the original first paint and must disappear with that paint.
    const root = loadSnapshots(write(HIDDEN_FIRST, undefined, undefined, { fill: "vHidden", gap: "v5" }))
      .snapshot.componentSets[0]?.components[0]?.root;
    expect(root?.bound).toEqual({ gap: "v5" });
  });

  it("docs/reference/spec.md section 4.1: retain bound.fill when the original first fill is visible", () => {
    const shownFirst = [HIDDEN_FIRST[1], HIDDEN_FIRST[0]];
    const root = loadSnapshots(write(shownFirst, undefined, undefined, { fill: "vShown" }))
      .snapshot.componentSets[0]?.components[0]?.root;
    expect(root?.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]);
    expect(root?.bound).toEqual({ fill: "vShown" });
  });

  it("docs/reference/spec.md section 4.1: remove hidden stroke bindings while retaining unrelated bindings", () => {
    const hiddenStroke = [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2, visible: false }];
    const root = loadSnapshots(write(undefined, hiddenStroke, undefined, { stroke: "vStroke", radius: "v7" }))
      .snapshot.componentSets[0]?.components[0]?.root;
    expect(root?.bound).toEqual({ radius: "v7" });
  });

  it("schema validation rejects malformed paints after loading", () => {
    expect(() => loadSnapshots(write([null], undefined))).toThrow(/Expected object, received null/);
  });

  it("fills inside extra metadata remain unchanged", () => {
    const inExtra = [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: false }];
    const root = loadSnapshots(write(undefined, undefined, { fills: inExtra })).snapshot
      .componentSets[0]?.components[0]?.root;
    expect(root?.extra).toEqual({ fills: inExtra });
  });

  it("snapshots without hidden paints remain unchanged", () => {
    const shown = [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }];
    const root = loadSnapshots(write(shown, undefined)).snapshot.componentSets[0]?.components[0]?.root;
    expect(root?.fills).toEqual(shown);
  });
});

describe("snapshot loading failures", () => {
  const writeText = (name: string, text: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), "tokenloom-load-")), name);
    writeFileSync(path, text);
    return path;
  };

  it("names the file that is not valid JSON, because --from accepts several", () => {
    const path = writeText("broken.json", "{ not json");

    expect(() => loadSnapshots(path)).toThrow(new RegExp(`^${path} is not valid JSON: `));
  });

  it("lists the failing field paths instead of the raw validation dump", () => {
    const path = writeText("wrong.json", JSON.stringify({ version: 2 }));

    expect(() => loadSnapshots(path)).toThrow(
      `${path} does not match the expected shape:\n  version: Invalid literal value, expected 1`,
    );
  });
});

describe("plugin export accepted wherever a Snapshot is (initiative UX-R01, UX-R02, UX-R10)", () => {
  const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

  /** One page fragment in either representation: `base64` for a plugin export, `path` for a saved Snapshot. */
  function build(render: { base64?: string; path?: string }, extra: Record<string, unknown> = {}): unknown {
    return {
      version: 1,
      source: { kind: "plugin", plan: "starter", fileKey: "FK", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
      collections: [], variables: [], textStyles: [], annotations: [],
      componentSets: [{
        id: "1:1", name: "Card", props: { tone: ["a"] },
        components: [{
          id: "1:2", props: { tone: "a" },
          root: { id: "1:3", name: "Root", type: "FRAME", visible: true, bbox: { x: 0, y: 0, w: 10, h: 10 }, bound: {}, children: [] },
          ...(render.base64 === undefined ? {} : { renderPngBase64: render.base64 }),
          ...(render.path === undefined ? {} : { renderPng: render.path }),
        }],
      }],
      ...extra,
    };
  }

  function writeAs(name: string, value: unknown): string {
    const path = join(mkdtempSync(join(tmpdir(), "tokenloom-direct-")), name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  it("loads a plugin export carrying embedded render data", () => {
    const path = writeAs("checkout.json", build({ base64: PNG_BASE64 }));

    const set = loadSnapshots(path).snapshot.componentSets[0];

    expect(set?.components[0]?.id).toBe("1:2");
  });

  it("emits no renderPng for direct input, because nothing writes the file it would name", () => {
    const path = writeAs("checkout.json", build({ base64: PNG_BASE64 }));

    const component = loadSnapshots(path).snapshot.componentSets[0]?.components[0];

    expect(component?.renderPng).toBe(undefined);
  });

  it("writes no file beside a directly loaded export", () => {
    const path = writeAs("checkout.json", build({ base64: PNG_BASE64 }));

    loadSnapshots(path);

    expect(readdirSync(dirname(path))).toEqual(["checkout.json"]);
  });

  it("normalizes an export with embedded renders to the same data as the export without them", () => {
    const withRender = loadSnapshots(writeAs("a.json", build({ base64: PNG_BASE64 }))).snapshot;
    const withoutRender = loadSnapshots(writeAs("b.json", build({}))).snapshot;

    expect(withRender).toEqual(withoutRender);
  });

  it("preserves renderPng when the input is a saved Snapshot", () => {
    const path = writeAs("snapshot.json", build({ path: "render/1-2.png" }));

    const component = loadSnapshots(path).snapshot.componentSets[0]?.components[0];

    expect(component?.renderPng).toBe("render/1-2.png");
  });

  it("rejects an input carrying both render fields instead of guessing which one wins", () => {
    const path = writeAs("mixed.json", build({ base64: PNG_BASE64, path: "render/1-2.png" }));

    expect(() => loadSnapshots(path)).toThrow(
      `${path} carries both renderPngBase64 and renderPng; import it with "tokenloom snapshot import" instead`,
    );
  });

  it("drops the plugin-only page field, which the Snapshot contract does not carry", () => {
    const path = writeAs("checkout.json", build({ base64: PNG_BASE64 }, { page: { id: "0:1", name: "Checkout" } }));

    expect(loadSnapshots(path).snapshot).not.toHaveProperty("page");
  });

  it.each(["export.txt", "snapshot.json", "no-extension"])(
    "decides the format from the render field, not the file name %s",
    (name) => {
      const path = writeAs(name, build({ base64: PNG_BASE64 }));

      const component = loadSnapshots(path).snapshot.componentSets[0]?.components[0];

      expect(component?.renderPng).toBe(undefined);
    },
  );

  it("reports the failing field instead of falling through to the other interpretation", () => {
    const path = writeAs("broken.json", build({ base64: PNG_BASE64 }, { version: 2 }));

    expect(() => loadSnapshots(path)).toThrow(
      `${path} does not match the expected shape:\n  version: Invalid literal value, expected 1`,
    );
  });
});
