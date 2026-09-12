import { describe, expect, it } from "vitest";
import type { AgentDiscoveryT } from "@tokenloom/schema";
import { discoverComponentSets } from "@tokenloom/parser";
import {
  DISCOVERY_NAMES, discoveryBytes, discoveryRecord, discoverySnapshot,
} from "../../../bench/discovery.bench";

/** docs/reference/verification.md section 12.7 owns both limits. */
const DISCOVERY_BYTES_LIMIT = 4096;
const DISCOVERY_ITEM_LIMIT = 20;

const payload = (over: Partial<AgentDiscoveryT> = {}): AgentDiscoveryT => ({
  components: [{ name: "Button", variants: 3 }, { name: "Card", variants: 0 }],
  count: 2,
  next: ["context --from <snapshot> --view agent --json -- <name>"],
  returned: 2,
  truncated: false,
  ...over,
});

describe("discovery fixture", () => {
  it("builds one component set per name, in the order given", () => {
    const snapshot = discoverySnapshot(["Tooltip", "Button"]);

    expect(snapshot.componentSets.map((set) => set.name)).toEqual(["Tooltip", "Button"]);
  });

  it("takes the component count from the name, so reordering cannot change it", () => {
    const names = ["Tooltip", "DatePicker", "Checkbox"];

    const counts = (given: string[]): number[] =>
      discoverySnapshot(given).componentSets.map((set) => set.components.length);

    expect(counts(names)).toEqual([3, 1, 4]);
    expect(counts([...names].reverse())).toEqual([4, 1, 3]);
  });

  it("includes a set with one component so the payload carries a zero-variant item", () => {
    const counts = discoverySnapshot(DISCOVERY_NAMES).componentSets.map((set) => set.components.length);

    expect(counts).toContain(1);
  });

  it("produces identical bytes for the same names on every call", () => {
    const names = ["Tooltip", "Button"];

    expect(JSON.stringify(discoverySnapshot(names))).toBe(JSON.stringify(discoverySnapshot(names)));
  });
});

describe("discovery payload measurement", () => {
  it("measures the serialized envelope rather than the item list alone", () => {
    const withNext = discoveryBytes(payload());
    const withoutNext = discoveryBytes(payload({ next: [] }));

    expect(withNext).toBeGreaterThan(withoutNext);
  });

  it("counts the exact bytes of the stable serialization of a known envelope", () => {
    expect(discoveryBytes(payload())).toBe(269);
  });
});

describe("discovery record", () => {
  it("carries the payload counts and the measured population", () => {
    const record = discoveryRecord(payload({ count: 24, returned: 20, truncated: true }), 24, [1]);

    expect(record).toMatchObject({ name: "context.discovery", componentSets: 24, count: 24, returned: 20 });
  });

  it("records a truncated payload as 1 because a record field is a number or a string", () => {
    expect(discoveryRecord(payload({ truncated: true }), 24, [1]).truncated).toBe(1);
  });

  it("records an untruncated payload as 0 rather than omitting the field", () => {
    expect(discoveryRecord(payload(), 24, [1]).truncated).toBe(0);
  });

  it("emits every field the benchmark record contract names", () => {
    expect(Object.keys(discoveryRecord(payload(), 24, [1])).sort()).toEqual([
      "bytes", "componentSets", "count", "name", "p50", "p99", "returned", "truncated",
    ]);
  });

  it("keeps raw latency precision instead of rounding it to three decimals", () => {
    const record = discoveryRecord(payload(), 24, [0.00012345678]);

    expect(record.p99).toBe(0.00012345678);
  });
});

describe("discovery on the generated population", () => {
  it("exercises long escaped multibyte names and long ids in the public payload", () => {
    const snapshot = discoverySnapshot(DISCOVERY_NAMES);
    const found = discoverComponentSets(snapshot);

    expect({
      sets: snapshot.componentSets.length,
      longName: Math.min(...snapshot.componentSets.map((set) => Buffer.byteLength(set.name, "utf8"))) > 256,
      escapedName: snapshot.componentSets.some((set) => JSON.stringify(set.name).length > set.name.length + 2),
      multibyteName: snapshot.componentSets.some((set) => Buffer.byteLength(set.name, "utf8") > set.name.length),
      longId: found.components.some((item) => item.id !== undefined && Buffer.byteLength(item.id, "utf8") > 256),
    }).toEqual({ sets: 24, longName: true, escapedName: true, multibyteName: true, longId: true });
  });

  it("binds on serialized bytes where the former short population bound only on item count", () => {
    const stressed = discoverComponentSets(discoverySnapshot(DISCOVERY_NAMES));
    const shortNames = DISCOVERY_NAMES.map((_name, index) => `Component${String(index).padStart(2, "0")}`);
    const short = discoverComponentSets(discoverySnapshot(shortNames));

    expect({
      stressed: { count: stressed.count, returned: stressed.returned, truncated: stressed.truncated },
      short: { count: short.count, returned: short.returned, truncated: short.truncated },
    }).toEqual({
      stressed: { count: 24, returned: stressed.returned, truncated: true },
      short: { count: 24, returned: DISCOVERY_ITEM_LIMIT, truncated: true },
    });
    expect(stressed.returned).toBeLessThan(DISCOVERY_ITEM_LIMIT);
  });

  it("keeps the default envelope inside the four-kilobyte budget", () => {
    expect(discoveryBytes(discoverComponentSets(discoverySnapshot(DISCOVERY_NAMES))))
      .toBeLessThanOrEqual(DISCOVERY_BYTES_LIMIT);
  });

  it("sorts by name, so a shuffled input produces byte-identical output", () => {
    const shuffled = [...DISCOVERY_NAMES].reverse();

    expect(discoverComponentSets(discoverySnapshot(shuffled)))
      .toEqual(discoverComponentSets(discoverySnapshot(DISCOVERY_NAMES)));
  });

  it("returns every match without truncation when the filter selects fewer than the limit", () => {
    const found = discoverComponentSets(discoverySnapshot(DISCOVERY_NAMES), "ba");

    expect(found).toMatchObject({ count: 2, returned: 2, truncated: false });
  });

  it("reports an explicit zero-result structure rather than an empty payload", () => {
    const found = discoverComponentSets(discoverySnapshot(DISCOVERY_NAMES), "definitely-no-match");

    expect(found).toMatchObject({ components: [], count: 0, returned: 0, truncated: false });
    expect(found.next.length).toBeGreaterThan(0);
  });
});
