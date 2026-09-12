import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../../tokenloom.config";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");

/** A minimal transparent PNG tests base64 extraction without unrelated image content. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const STAMP = { sha: "1726c7bdeadbeef0000000000000000000000000", builtAt: "2026-09-03T13:00:00Z" };

function makeExport(withPng: boolean, exporter?: { sha: string; builtAt: string }): unknown {
  return {
    version: 1,
    source: {
      kind: "plugin", plan: "starter", fileKey: "FK", fileVersion: "v9", fetchedAt: "2026-01-01T00:00:00Z",
      ...(exporter === undefined ? {} : { exporter }),
    },
    page: { id: "0:1", name: "Page 1" },
    collections: [{ id: "c1", name: "P", modes: [{ id: "m0", name: "Value" }], defaultModeId: "m0" }],
    variables: [{ id: "v1", name: "color/bg", collectionId: "c1", type: "COLOR", valuesByMode: { m0: { r: 0, g: 0, b: 0, a: 1 } } }],
    textStyles: [],
    componentSets: [{
      id: "1:1", name: "Card", props: { tone: ["a"] },
      components: [{
        id: "1:2", props: { tone: "a" },
        root: {
          id: "1:2", name: "Card", type: "COMPONENT", visible: true,
          bbox: { x: 0, y: 0, w: 10, h: 10 }, bound: {}, children: [],
        },
        ...(withPng ? { renderPngBase64: PNG_BASE64 } : {}),
      }],
    }],
    annotations: [],
  };
}

function runImport(exportBody: unknown, extra: string[] = []): { status: number; into: string; stderr: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "tl-import-"));
  const exportPath = join(dir, "export.json");
  writeFileSync(exportPath, JSON.stringify(exportBody));
  const into = join(dir, "sample");
  const res = spawnSync("node", [CLI, "snapshot", "import", exportPath, "--into", into, ...extra], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
  });
  return { status: res.status ?? -1, into, stderr: res.stderr, stdout: res.stdout };
}

describe("snapshot import", () => {
  it("snapshot import extracts renderPngBase64 into render/<id>.png", () => {
    const { status, into } = runImport(makeExport(true));
    expect(status).toBe(0);
    expect(existsSync(join(into, "render/1-2.png"))).toBe(true);
    const bytes = readFileSync(join(into, "render/1-2.png"));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("imported snapshot.json references renderPng paths instead of base64", () => {
    const { into } = runImport(makeExport(true));
    const snapshot = JSON.parse(readFileSync(join(into, "snapshot.json"), "utf8")) as {
      componentSets: { components: { renderPng?: string; renderPngBase64?: string }[] }[];
    };
    const component = snapshot.componentSets[0]?.components[0];
    expect(component?.renderPng).toBe("render/1-2.png");
    expect(component?.renderPngBase64).toBe(undefined);
  });

  it("imported snapshots pass schema validation and are readable by the CLI", () => {
    const { into } = runImport(makeExport(true));
    const res = spawnSync("node", [CLI, "context", "Card", "--from", join(into, "snapshot.json"), "--json"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
    });
    expect(res.status).toBe(0);
    expect((JSON.parse(res.stdout) as { component: { block: string } }).component.block).toBe("card");
  });

  it("imports without PNG data succeed without creating a render directory", () => {
    const { status, into } = runImport(makeExport(false));
    expect(status).toBe(0);
    expect(existsSync(join(into, "render"))).toBe(false);
    expect(existsSync(join(into, "snapshot.json"))).toBe(true);
  });

  it("docs/reference/spec.md section 4.9: matching --expect-exporter prints the stamp and exits successfully", () => {
    const { status, stdout } = runImport(makeExport(false, STAMP), ["--expect-exporter", STAMP.sha]);
    expect(status).toBe(0);
    expect(stdout).toBe(`exporter: ${STAMP.sha} ${STAMP.builtAt}\n`);
  });

  const OTHER_SHA = "0000000000000000000000000000000000000000";
  const DIRTY_STAMP = { sha: `${STAMP.sha}-dirty`, builtAt: STAMP.builtAt };
  const rejected: [label: string, exporter: typeof STAMP | undefined, expect: string, reason: string][] = [
    ["when the SHA differs", STAMP, OTHER_SHA, `exporter sha mismatch: expected ${OTHER_SHA}, found ${STAMP.sha}`],
    ["when the stamp is missing", undefined, STAMP.sha, "no exporter stamp: the plugin bundle was built before exporter stamping existed"],
    ["when a matching hexadecimal SHA has a dirty suffix", DIRTY_STAMP, STAMP.sha, `exporter built from a dirty tree: ${DIRTY_STAMP.sha}`],
    ["when the expected stamp itself has a dirty suffix", DIRTY_STAMP, DIRTY_STAMP.sha, `exporter built from a dirty tree: ${DIRTY_STAMP.sha}`],
  ];

  it.each(rejected)("docs/reference/spec.md section 4.9: --expect-exporter exits with code 1 and a reason %s", (_label, exporter, expected, reason) => {
    const { status, stderr } = runImport(makeExport(false, exporter), ["--expect-exporter", expected]);
    expect([status, stderr]).toEqual([1, `tokenloom: snapshot import: ${reason}\n`]);
  });

  it("docs/reference/spec.md section 4.9: rejected exports leave no snapshot.json", () => {
    const { into } = runImport(makeExport(false, STAMP), ["--expect-exporter", OTHER_SHA]);
    expect(existsSync(join(into, "snapshot.json"))).toBe(false);
  });

  const noFlag: [label: string, exporter: typeof STAMP | undefined, line: string][] = [
    ["the SHA and builtAt for stamped exports", STAMP, `exporter: ${STAMP.sha} ${STAMP.builtAt}\n`],
    ["none for unstamped exports", undefined, "exporter: none\n"],
  ];

  it.each(noFlag)("docs/reference/spec.md section 4.9: without validation flags, print %s and exit successfully", (_label, exporter, line) => {
    const { status, stdout } = runImport(makeExport(false, exporter));
    expect([status, stdout]).toEqual([0, line]);
  });

  it("docs/reference/spec.md section 4.9: preserve the stamp in snapshot.json source metadata", () => {
    const { into } = runImport(makeExport(false, STAMP), ["--expect-exporter", STAMP.sha]);
    const snapshot = JSON.parse(readFileSync(join(into, "snapshot.json"), "utf8")) as {
      source: { exporter?: { sha: string; builtAt: string } };
    };
    expect(snapshot.source.exporter).toEqual(STAMP);
  });

  it("docs/reference/spec.md section 4.9: without validation flags, print dirty stamps and exit successfully", () => {
    const { status, stdout } = runImport(makeExport(false, DIRTY_STAMP));
    expect([status, stdout]).toEqual([0, `exporter: ${DIRTY_STAMP.sha} ${DIRTY_STAMP.builtAt}\n`]);
  });

  it("docs/reference/spec.md section 4.9: --plan and --file-key override imported snapshot source metadata", () => {
    const { status, into, stderr } = runImport(makeExport(false, STAMP), [
      "--expect-exporter", STAMP.sha, "--plan", "enterprise", "--file-key", "FK-FROM-FLAG",
    ]);
    const snapshot = JSON.parse(readFileSync(join(into, "snapshot.json"), "utf8")) as {
      source: { plan: string; fileKey: string };
    };
    expect([status, snapshot.source.plan, snapshot.source.fileKey]).toEqual([0, "enterprise", "FK-FROM-FLAG"]);
    expect(stderr).toContain("snapshot import: source.plan=enterprise source.fileKey=FK-FROM-FLAG\n");
  });

  it("docs/reference/spec.md section 4.9: omitted options use the configured plan and exported file key", () => {
    // Read the expected value from the configuration that owns it.
    const configPlan = (config as { plan: string }).plan;
    const { status, into } = runImport(makeExport(false, STAMP), ["--expect-exporter", STAMP.sha]);
    const snapshot = JSON.parse(readFileSync(join(into, "snapshot.json"), "utf8")) as {
      source: { plan: string; fileKey: string };
    };
    // makeExport supplies the starter plan and FK file key.
    expect([status, snapshot.source.plan, snapshot.source.fileKey]).toEqual([0, configPlan, "FK"]);
  });

  it("docs/reference/spec.md section 4.9: --expect-exporter without a value exits with code 1", () => {
    const { status, stderr } = runImport(makeExport(false, STAMP), ["--expect-exporter"]);
    expect(status).toBe(1);
    expect(stderr).toBe("tokenloom: snapshot import: --expect-exporter needs a sha\n");
  });

  function contextFrom(snapshotPath: string, name: string): { status: number; stdout: string } {
    const res = spawnSync("node", [CLI, "context", name, "--from", snapshotPath, "--json"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
    });
    return { status: res.status ?? -1, stdout: res.stdout };
  }

  // docs/reference/spec.md section 4.9: Stamp validation belongs to import, not snapshot loading.
  // Build an unstamped Snapshot explicitly because the saved sample is now stamped.

  it("docs/reference/spec.md section 4.9: the loader accepts both stamped and unstamped snapshots", () => {
    const { into } = runImport(makeExport(false));
    const stampless = JSON.parse(readFileSync(join(into, "snapshot.json"), "utf8")) as {
      source: { exporter?: unknown };
    };
    const designSystem = JSON.parse(readFileSync(join(repoRoot, "samples/real-design-system/snapshot.json"), "utf8")) as {
      source: { exporter?: unknown };
    };
    expect([stampless.source.exporter, designSystem.source.exporter === undefined]).toEqual([undefined, false]);
    expect(contextFrom(join(into, "snapshot.json"), "Card").status).toBe(0);

    const res = contextFrom("samples/real-design-system/snapshot.json", "Button");
    expect(res.status).toBe(0);
    expect((JSON.parse(res.stdout) as { component: { block: string } }).component.block).toBe("button");
  });

  it("snapshot import without --into exits with code 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "tl-import-"));
    const exportPath = join(dir, "export.json");
    writeFileSync(exportPath, JSON.stringify(makeExport(false)));
    const res = spawnSync("node", [CLI, "snapshot", "import", exportPath], { encoding: "utf8", cwd: repoRoot });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--into");
  });
});
