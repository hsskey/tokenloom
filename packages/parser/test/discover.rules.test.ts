import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentDiscovery, AgentError, Snapshot, stableJsonFile } from "@tokenloom/schema";
import type { RawNodeT, SnapshotT } from "@tokenloom/schema";
import {
  DISCOVERY_LIMIT, agentError, buildDesignContext, discoverComponentSets, selectComponentSet, selectVariant,
} from "../src/index";

const leaf = (id: string): RawNodeT => ({
  id, name: id, type: "FRAME", visible: true,
  bbox: { x: 0, y: 0, w: 8, h: 8 }, bound: {}, children: [],
} as unknown as RawNodeT);

interface SetSpec {
  id: string;
  name: string;
  components: number;
  hidden?: number;
}

function snapshotOf(specs: SetSpec[]): SnapshotT {
  return Snapshot.parse({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "F", fileVersion: "v1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: specs.map((spec) => ({
      id: spec.id,
      name: spec.name,
      props: { size: ["a"] },
      components: Array.from({ length: spec.components }, (_, i) => ({
        id: `${spec.id}-${i}`,
        props: { size: "a" },
        root: { ...leaf(`${spec.id}-${i}`), visible: i < spec.components - (spec.hidden ?? 0) },
      })),
    })),
  });
}

const named = (count: number, components = 3): SetSpec[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${100 + i}:1`, name: `C${String(i).padStart(2, "0")}`, components }));

describe("Agent discovery rules from docs/reference/spec.md section 4.12", () => {
  it("A07: results are sorted by name regardless of the order the snapshot declares them", () => {
    const forward = discoverComponentSets(snapshotOf(named(5)));

    const reversed = discoverComponentSets(snapshotOf([...named(5)].reverse()));

    expect(reversed.components.map((c) => c.name)).toEqual(forward.components.map((c) => c.name));
  });

  it("A07: duplicate names and ids are ordered by their remaining emitted field", () => {
    const specs = [
      { id: "12:34", name: "Button", components: 4 },
      { id: "12:34", name: "Button", components: 2 },
    ];
    const forward = discoverComponentSets(snapshotOf(specs));
    const reversed = discoverComponentSets(snapshotOf([...specs].reverse()));
    const expected = [
      { id: "12:34", name: "Button", variants: 1 },
      { id: "12:34", name: "Button", variants: 3 },
    ];

    expect({
      forward: forward.components,
      reversed: reversed.components,
      serialized: stableJsonFile(forward) === stableJsonFile(reversed),
    }).toEqual({ forward: expected, reversed: expected, serialized: true });
  });

  it("A08: duplicate name and node lookup rejects both input orders", () => {
    const specs = [
      { id: "12:34", name: "Button", components: 4 },
      { id: "12:34", name: "Button", components: 2 },
    ];
    const expected = {
      ok: false, kind: "collision", name: "Button", candidates: ["12:34", "12:34"],
    };

    expect({
      forward: selectComponentSet(snapshotOf(specs), "Button", "12:34"),
      reversed: selectComponentSet(snapshotOf([...specs].reverse()), "Button", "12:34"),
    }).toEqual({ forward: expected, reversed: expected });
  });

  it("A08: name and node together resolve despite another name sharing the node id", () => {
    const specs = [
      { id: "X", name: "Button", components: 2 },
      { id: "Y", name: "Button", components: 3 },
      { id: "X", name: "Card", components: 4 },
    ];
    const snapshots = [snapshotOf(specs), snapshotOf([...specs].reverse())];

    expect(snapshots.map((snapshot) => {
      const selected = selectComponentSet(snapshot, "Button", "X");
      return {
        discovery: discoverComponentSets(snapshot).components,
        selected: selected.ok
          ? { ok: true, id: selected.set.id, name: selected.set.name, components: selected.set.components.length }
          : selected,
      };
    })).toEqual([
      {
        discovery: [
          { id: "X", name: "Button", variants: 1 },
          { id: "Y", name: "Button", variants: 2 },
          { name: "Card", variants: 3 },
        ],
        selected: { ok: true, id: "X", name: "Button", components: 2 },
      },
      {
        discovery: [
          { id: "X", name: "Button", variants: 1 },
          { id: "Y", name: "Button", variants: 2 },
          { name: "Card", variants: 3 },
        ],
        selected: { ok: true, id: "X", name: "Button", components: 2 },
      },
    ]);
  });

  it("A07: at most twenty items are returned while count reports every match", () => {
    const result = discoverComponentSets(snapshotOf(named(24)));

    expect({ count: result.count, returned: result.returned, truncated: result.truncated, items: result.components.length })
      .toEqual({ count: 24, returned: DISCOVERY_LIMIT, truncated: true, items: DISCOVERY_LIMIT });
  });

  it("A07: a complete page reports truncated false and equal count and returned", () => {
    const result = discoverComponentSets(snapshotOf(named(3)));

    expect({ count: result.count, returned: result.returned, truncated: result.truncated })
      .toEqual({ count: 3, returned: 3, truncated: false });
  });

  it("A07: an item carries the name and the variant count and nothing else when the name is unique", () => {
    const result = discoverComponentSets(snapshotOf(named(1, 7)));

    expect(result.components).toEqual([{ name: "C00", variants: 6 }]);
  });

  it("A07: the variant count excludes hidden roots omitted by canonical construction", () => {
    const result = discoverComponentSets(snapshotOf([
      { id: "1:1", name: "Button", components: 3, hidden: 1 },
    ]));

    expect(result.components).toEqual([{ name: "Button", variants: 1 }]);
  });

  it("A07: a repeated name carries its node id so the caller can disambiguate", () => {
    const result = discoverComponentSets(snapshotOf([
      { id: "12:99", name: "Button", components: 2 },
      { id: "12:34", name: "Button", components: 4 },
      { id: "13:00", name: "Card", components: 1 },
    ]));

    expect(result.components).toEqual([
      { id: "12:34", name: "Button", variants: 3 },
      { id: "12:99", name: "Button", variants: 1 },
      { name: "Card", variants: 0 },
    ]);
  });

  it("A07: --match filters by case-insensitive substring without changing which fields an item carries", () => {
    const result = discoverComponentSets(snapshotOf([
      { id: "1:1", name: "PrimaryButton", components: 2 },
      { id: "1:2", name: "Card", components: 2 },
    ]), "BUTTON");

    expect(result.components).toEqual([{ name: "PrimaryButton", variants: 1 }]);
  });

  it("A08: a zero-result discovery returns explicit counts and a listing template", () => {
    const result = discoverComponentSets(snapshotOf(named(4)), "definitely-no-match");

    expect(result).toEqual({
      components: [], count: 0, returned: 0, truncated: false,
      next: ["context --from <snapshot> --view agent --json"],
    });
  });

  it("A07: the serialized UTF-8 page keeps complete identities within 4096 bytes", () => {
    const name = `A${"한,\"\\".repeat(250)}`;
    const specs = [
      { id: `1:${"x".repeat(300)}`, name, components: 2 },
      { id: `2:${"y".repeat(300)}`, name, components: 2 },
      ...named(18).map((spec) => ({ ...spec, name: `${spec.name}${"z".repeat(1024)}` })),
    ];

    const result = discoverComponentSets(snapshotOf(specs));

    expect({
      bytes: Buffer.byteLength(stableJsonFile(result), "utf8") <= 4096,
      components: result.components,
      count: result.count,
      returned: result.returned,
      truncated: result.truncated,
    }).toEqual({
      bytes: true,
      components: [{ id: specs[0]?.id, name, variants: 1 }],
      count: 20,
      returned: 1,
      truncated: true,
    });
  });

  it("A07: an oversized first item returns no later item and reports the match", () => {
    const result = discoverComponentSets(snapshotOf([
      { id: "1:1", name: `A${"😀".repeat(1200)}`, components: 2 },
      { id: "1:2", name: "Button", components: 2 },
    ]));

    expect({
      bytes: Buffer.byteLength(stableJsonFile(result), "utf8") <= 4096,
      components: result.components,
      count: result.count,
      returned: result.returned,
      truncated: result.truncated,
    }).toEqual({ bytes: true, components: [], count: 2, returned: 0, truncated: true });
  });

  it("A08: a truncated page adds the narrowing template", () => {
    const result = discoverComponentSets(snapshotOf(named(24)));

    expect(result.next).toEqual([
      "context --from <snapshot> --view agent --json -- <name>",
      "context --match <text> --from <snapshot> --view agent --json",
    ]);
  });

  it("A08: a missing component set becomes COMPONENT_NOT_FOUND pointing back at discovery", () => {
    const body = agentError({ ok: false, kind: "not-found", name: "Nope" });

    expect(body).toEqual({
      error: { code: "COMPONENT_NOT_FOUND", detail: 'component set "Nope" not found' },
      next: ["context --from <snapshot> --view agent --json"],
    });
  });

  it("A08: a name collision reports the candidate node ids and the --node template", () => {
    const body = agentError({ ok: false, kind: "collision", name: "Button", candidates: ["12:34", "12:99"] });

    expect(body).toEqual({
      error: { candidates: ["12:34", "12:99"], code: "NAME_COLLISION", detail: '"Button" matches 2 component sets' },
      next: ["context --node=<id> --from <snapshot> --view agent --json -- <name>"],
    });
  });

  it("A08: a mixed name collision recommends a uniquely resolvable node id", () => {
    const snapshot = snapshotOf([
      { id: "12:34", name: "Button", components: 4 },
      { id: "12:34", name: "Button", components: 2 },
      { id: "12:99", name: "Button", components: 3 },
    ]);
    const selected = selectComponentSet(snapshot, "Button");
    if (selected.ok) throw new Error("mixed lookup identities selected an arbitrary component set");
    const body = agentError(selected);

    expect({
      discovery: discoverComponentSets(snapshot).components,
      body,
      schemaValid: AgentError.safeParse(body).success,
    }).toEqual({
      discovery: [
        { id: "12:34", name: "Button", variants: 1 },
        { id: "12:34", name: "Button", variants: 3 },
        { id: "12:99", name: "Button", variants: 2 },
      ],
      body: {
        error: {
          candidates: ["12:34", "12:34", "12:99"],
          code: "NAME_COLLISION",
          detail: '"Button" matches 3 component sets',
        },
        next: ["context --node=<id> --from <snapshot> --view agent --json -- <name>"],
      },
      schemaValid: true,
    });
  });

  it("A08: mixed-collision regression catches duplicate-presence classification", () => {
    const failure = {
      ok: false as const,
      kind: "collision" as const,
      name: "Button",
      candidates: ["12:34", "12:34", "12:99"],
    };
    const actual = agentError(failure);
    const duplicatePresenceNext = failure.candidates.some((id, index) => failure.candidates.indexOf(id) < index)
      ? ["context --from <snapshot> --view agent --json"]
      : ["context --node=<id> --from <snapshot> --view agent --json -- <name>"];
    const caught = actual.next.toString() === duplicatePresenceNext.toString() ? 0 : 1;

    expect({ attempted: 1, caught, survived: 1 - caught }).toEqual({ attempted: 1, caught: 1, survived: 0 });
  });

  it("A08: a duplicate lookup identity requires a corrected snapshot instead of the same node id", () => {
    const snapshot = snapshotOf([
      { id: "12:34", name: "Button", components: 4 },
      { id: "12:34", name: "Button", components: 2 },
    ]);
    const selected = selectComponentSet(snapshot, "Button", "12:34");
    if (selected.ok) throw new Error("duplicate lookup identity selected an arbitrary component set");

    expect(agentError(selected)).toEqual({
      error: {
        candidates: ["12:34", "12:34"],
        code: "NAME_COLLISION",
        detail: '"Button" matches 2 component sets with duplicate node id "12:34"; use a corrected snapshot',
      },
      next: ["context --from <snapshot> --view agent --json"],
    });
  });

  it("A08: an empty component set becomes COMPONENT_SET_EMPTY", () => {
    const body = agentError({ ok: false, kind: "empty", name: "Button" });

    expect(body.error).toEqual({ code: "COMPONENT_SET_EMPTY", detail: '"Button" has no components' });
  });

  it("A08: a selector failure keeps its code and available values under the retry template", () => {
    const built = buildDesignContext(
      Snapshot.parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../samples/button/snapshot.json"), "utf8"))),
      { name: "Button" },
    );
    if (!built.ok) throw new Error("the button sample did not build a design context");
    const selected = selectVariant(built.context, "size=zzz");
    if (selected.ok) throw new Error("an unknown value must not select a variant");

    const body = agentError(selected.failure);

    expect(body).toEqual({
      error: {
        available: ["size=md,variant=primary", "size=md,variant=secondary"],
        code: "VARIANT_NOT_FOUND",
        detail: 'no variant matches "size=zzz"',
      },
      next: ["context --variant=<selector> --from <snapshot> --view agent --json -- <name>"],
    });
  });
  it("A07: the discovery payload validates against the declared AgentDiscovery contract", () => {
    const result = discoverComponentSets(snapshotOf(named(24)));

    expect(AgentDiscovery.safeParse(result).success).toBe(true);
  });

  it("A08: the collision payload validates against the declared AgentError contract", () => {
    const body = agentError({ ok: false, kind: "collision", name: "Button", candidates: ["12:34", "12:99"] });

    expect(AgentError.safeParse(body).success).toBe(true);
  });
});
