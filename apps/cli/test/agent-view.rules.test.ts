import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableJsonFile } from "@tokenloom/schema";

const root = resolve(import.meta.dirname, "../../..");
const cli = resolve(root, "apps/cli/dist/tokenloom.js");
const snapshot = "samples/button/snapshot.json";
const designSystem = "samples/real-design-system/snapshot.json";

const run = (args: string[]) =>
  spawnSync(process.execPath, [cli, "context", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
  });

const context = (args: string[]) => run(["Button", "--from", snapshot, "--annotations", "--json", ...args]);

const discovery = (args: string[]) => {
  const result = run(["--from", ...args, "--view", "agent", "--json"]);
  return { status: result.status, payload: JSON.parse(result.stdout) as DiscoveryPayload };
};

interface DiscoveryPayload {
  components: { id?: string; name: string; variants: number }[];
  count: number;
  next: string[];
  returned: number;
  truncated: boolean;
}

/** A component set whose only job is to carry a name into discovery. */
const singleton = (index: number, name: string) => ({
  id: `9${index}:1`,
  name,
  props: { size: ["md"] },
  components: [{
    id: `9${index}:2`,
    props: { size: "md" },
    root: { id: `9${index}:3`, name: "Root", type: "FRAME", visible: true, bbox: { x: 0, y: 0, w: 1, h: 1 }, bound: {}, children: [] },
  }],
});

/** Write a snapshot whose component sets appear in the given order, which is never the sorted order. */
function snapshotOf(names: string[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "tl-discovery-")), "snapshot.json");
  writeFileSync(path, JSON.stringify({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "SYNTHETIC", fileVersion: "s1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: names.map((name, i) => singleton(i, name)),
  }));
  return path;
}

function variantSnapshotOf(
  componentProps: Record<string, string>[],
  declaredProps: Record<string, string[]>,
): string {
  const path = join(mkdtempSync(join(tmpdir(), "tl-variant-")), "snapshot.json");
  writeFileSync(path, JSON.stringify({
    version: 1,
    source: { kind: "sample", plan: "unknown", fileKey: "SYNTHETIC", fileVersion: "s1", fetchedAt: "2026-01-01T00:00:00Z" },
    collections: [], variables: [], textStyles: [], annotations: [],
    componentSets: [{
      id: "80:1",
      name: "Edge",
      props: declaredProps,
      components: componentProps.map((props, index) => ({
        id: `80:${index + 2}`,
        props,
        root: {
          id: `81:${index + 1}`, name: "Root", type: "FRAME", visible: true,
          bbox: { x: 0, y: 0, w: 1, h: 1 }, bound: {}, children: [],
        },
      })),
    }],
  }));
  return path;
}

const LABELS = Array.from({ length: 24 }, (_, i) => `C${String(i).padStart(2, "0")}`);
/** Rotated so the input order differs from the sorted order at every position. */
const rotated = [...LABELS.slice(13), ...LABELS.slice(0, 13)];

describe("Agent view CLI rules from docs/reference/spec.md section 4.11", () => {
  it("A04: context without --view still emits the canonical reference bytes", () => {
    const result = context([]);

    expect(result.stdout).toBe(readFileSync(resolve(root, "samples/button/reference/context.compact.json"), "utf8"));
  });

  it("A04: --view canonical emits the same bytes as the unspecified default", () => {
    const explicit = context(["--view", "canonical"]);

    expect(explicit.stdout).toBe(context([]).stdout);
  });

  it("A04: an unrecognized --view value is a usage error and prints no JSON", () => {
    const result = context(["--view", "compact"]);

    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 1, stdout: "" });
  });

  it("A05: the Agent view drops exactly the canonical version and source, so the CLI adds no rule of its own", () => {
    const canonical = JSON.parse(context([]).stdout) as Record<string, unknown>;
    delete canonical.version;
    delete canonical.source;

    const agent = context(["--view", "agent"]);

    expect(agent.stdout).toBe(stableJsonFile(canonical));
  });

  it("A07: an omitted component name lists every component set sorted by name with its variant count", () => {
    const { status, payload } = discovery([designSystem]);

    expect({ status, components: payload.components }).toEqual({
      status: 0,
      components: [
        { name: "Button", variants: 17 },
        { name: "Button Danger", variants: 11 },
        { name: "Button Group", variants: 4 },
        { name: "Icon Button", variants: 17 },
      ],
    });
  });

  it("A07: --match narrows the list and count reports the matches rather than the snapshot size", () => {
    const { payload } = discovery([designSystem, "--match", "icon"]);

    expect({
      components: payload.components,
      count: payload.count,
      returned: payload.returned,
      truncated: payload.truncated,
    }).toEqual({ components: [{ name: "Icon Button", variants: 17 }], count: 1, returned: 1, truncated: false });
  });

  it("A07: 24 component sets return the first 20 names in sorted order and report the real total", () => {
    const { payload } = discovery([snapshotOf(rotated)]);

    expect({
      names: payload.components.map((c) => c.name),
      count: payload.count,
      returned: payload.returned,
      truncated: payload.truncated,
    }).toEqual({ names: LABELS.slice(0, 20), count: 24, returned: 20, truncated: true });
  });

  it("A07: the same component sets in a different input order produce identical bytes", () => {
    const forward = run(["--from", snapshotOf(LABELS), "--view", "agent", "--json"]);
    const shuffled = run(["--from", snapshotOf(rotated), "--view", "agent", "--json"]);

    expect(shuffled.stdout).toBe(forward.stdout);
  });

  it("A07: a repeated component-set name carries the node id so the caller can disambiguate", () => {
    const { payload } = discovery([snapshotOf(["Dup", "Only", "Dup"])]);

    expect(payload.components).toEqual([
      { id: "90:1", name: "Dup", variants: 0 },
      { id: "92:1", name: "Dup", variants: 0 },
      { name: "Only", variants: 0 },
    ]);
  });

  it("A08: a discovery with no match answers with an explicit zero count instead of empty stdout", () => {
    const { status, payload } = discovery([designSystem, "--match", "definitely-no-match"]);

    expect({ status, components: payload.components, count: payload.count, returned: payload.returned })
      .toEqual({ status: 0, components: [], count: 0, returned: 0 });
  });

  it("A08: a discovery response carries next-command templates that never embed the caller's snapshot path", () => {
    const result = run(["--from", designSystem, "--view", "agent", "--json"]);
    const payload = JSON.parse(result.stdout) as DiscoveryPayload;

    expect({ hasNext: payload.next.length > 0, leaksPath: payload.next.some((n) => n.includes(designSystem)) })
      .toEqual({ hasNext: true, leaksPath: false });
  });

  it("A08: an unresolvable variant answers on stdout with a structured code, exit 1 and a silent stderr", () => {
    const result = run([
      "Chip", "--from", "samples/twenty-variants/snapshot.json", "--view", "agent", "--json",
      "--variant", "size=does-not-exist",
    ]);
    const payload = JSON.parse(result.stdout) as { error: { code: string; available: string[] }; next: string[] };

    expect({ status: result.status, code: payload.error.code, hasAvailable: payload.error.available.length > 0, stderr: result.stderr })
      .toEqual({ status: 1, code: "VARIANT_NOT_FOUND", hasAvailable: true, stderr: "" });
  });

  it("A08: schema-accepted unpaired code units remain structured in advertised Agent choices", () => {
    const result = run([
      "Edge", "--from", variantSnapshotOf(
        [{ label: "\uD800" }, { label: "safe" }],
        { label: ["\uD800", "safe"] },
      ), "--view", "agent", "--json", "--variant", "label=missing",
    ]);
    const payload = JSON.parse(result.stdout) as { error: { code: string; available: string[] } };

    expect({ status: result.status, error: payload.error, stderr: result.stderr }).toEqual({
      status: 1,
      error: { code: "VARIANT_NOT_FOUND", detail: 'no variant matches "label=missing"', available: ["label=%uD800", "label=safe"] },
      stderr: "",
    });
  });

  it("A08: a malformed code-unit escape returns Agent JSON instead of throwing", () => {
    const result = run([
      "Edge", "--from", variantSnapshotOf(
        [{ label: "\uD800" }, { label: "safe" }],
        { label: ["\uD800", "safe"] },
      ), "--view", "agent", "--json", "--variant", "label=%uZZZZ",
    ]);
    const payload = JSON.parse(result.stdout) as { error: { code: string } };

    expect({ status: result.status, code: payload.error.code, stderr: result.stderr })
      .toEqual({ status: 1, code: "VARIANT_SELECTOR_INVALID", stderr: "" });
  });

  it("A06: the CLI selects only an empty-property base with the advertised standalone selector", () => {
    const snapshotPath = variantSnapshotOf([{}, { kind: "variant" }], { kind: ["base", "variant"] });

    const selected = run(["Edge", "--from", snapshotPath, "--view", "agent", "--json", "--variant", "{}"]);
    const full = run(["Edge", "--from", snapshotPath, "--view", "agent", "--json"]);
    const selectedContext = JSON.parse(selected.stdout) as { component: { base: { props: object }; variants: object[] } };
    const fullContext = JSON.parse(full.stdout) as { component: { base: { props: object }; variants: object[] } };

    expect({
      status: selected.status,
      base: selectedContext.component.base.props,
      selectedVariants: selectedContext.component.variants,
      fullVariants: fullContext.component.variants.length,
    }).toEqual({ status: 0, base: {}, selectedVariants: [], fullVariants: 1 });
  });

  it("A08: an ambiguous component name answers on stdout with the candidate node ids", () => {
    const result = run(["Button", "--from", "samples/mutations/M06.json", "--view", "agent", "--json"]);
    const payload = JSON.parse(result.stdout) as { error: { code: string; candidates: string[] } };

    expect({ status: result.status, error: payload.error.code, candidates: payload.error.candidates })
      .toEqual({ status: 1, error: "NAME_COLLISION", candidates: ["12:34", "12:99"] });
  });

  it("A08: a successful codegen response carries no next key and no help text", () => {
    const payload = JSON.parse(context(["--view", "agent"]).stdout) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(["annotations", "component", "tokensUsed", "warnings"]);
  });
});
