// Reference scope locks expected values only; captures are evidence rather than references.
// Tests use a temporary tree to avoid touching real snapshot data.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { stableJsonFile } from "../packages/schema/src/stable";
import { LOCKED_PATTERNS, computeManifest, isLocked, lockedFiles, manifestDiff } from "./reference-lock";

/** Creates a file and its parent path. */
function put(root: string, rel: string, body: string): string {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

/** Tree mixing a reference, a PNG, and unlocked evidence files. */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "tl-lock-"));
  put(root, "samples/button/snapshot.json", "{}\n");
  put(root, "samples/button/reference/css/tokens.css", ":root{}\n");
  put(root, "samples/button/render/12-34.png", "PNGDATA");
  put(root, "samples/mutations/expected.json", "{}\n");
  put(root, "eval/thresholds.json", "{}\n");
  // Evidence excluded from the lock.
  put(root, "samples/captures/mcp/2026-09-03/12-34.json", "{}\n");
  put(root, "samples/captures/rest/FAKE/2026-09-03/files-depth4.json", "{}\n");
  put(root, "samples/button/captures/x.json", "{}\n");
  put(root, "samples/button/snapshot.rest.json", "{}\n");
  put(root, "samples/AUTHORING.md", "# doc\n");
  put(root, "eval/matrix.mvp.yaml", "model: x\n");
  return root;
}

function lock(root: string): void {
  writeFileSync(join(root, "samples/manifest.json"), stableJsonFile(computeManifest(root)));
}

describe("reference-lock scope", () => {
  it("locks only the five reference patterns", () => {
    expect(LOCKED_PATTERNS).toEqual([
      "samples/*/snapshot.json",
      "samples/*/reference/**",
      "samples/*/render/**",
      "samples/mutations/**",
      "eval/thresholds.json",
    ]);
    expect(lockedFiles(tree())).toEqual([
      "eval/thresholds.json",
      "samples/button/reference/css/tokens.css",
      "samples/button/render/12-34.png",
      "samples/button/snapshot.json",
      "samples/mutations/expected.json",
    ]);
  });

  it("excludes captures, Markdown, and snapshot.rest.json", () => {
    expect(isLocked("samples/captures/mcp/2026-09-03/12-34.json")).toBe(false);
    expect(isLocked("samples/captures/rest/FAKE/2026-09-03/files-depth4.json")).toBe(false);
    expect(isLocked("samples/button/captures/x.json")).toBe(false);
    expect(isLocked("samples/button/snapshot.rest.json")).toBe(false);
    expect(isLocked("samples/AUTHORING.md")).toBe(false);
    expect(isLocked("samples/real-design-system/README.md")).toBe(false);
    // Confirm locked paths through the same predicate.
    expect(isLocked("samples/real-design-system/render/108-12663.png")).toBe(true);
    expect(isLocked("samples/real-design-system/snapshot.json")).toBe(true);
    // `**` requires at least one remaining segment, so the directory name itself is not locked.
    expect(isLocked("samples/button/reference")).toBe(false);
    expect(isLocked("samples/button/reference/a.css")).toBe(true);
  });

  it("detects a one-byte PNG change during --check", () => {
    const root = tree();
    lock(root);
    expect(manifestDiff(root)).toEqual([]);
    // S3 visual-scoring expectations must not change silently.
    writeFileSync(join(root, "samples/button/render/12-34.png"), "PNGDATB");
    expect(manifestDiff(root)).toEqual(["samples/button/render/12-34.png"]);
  });

  it("ignores added or modified capture files during --check", () => {
    const root = tree();
    lock(root);
    put(root, "samples/captures/rest/FAKE/2026-09-03/nodes-batch-1.json", '{"new":1}\n');
    put(root, "samples/captures/rest/FAKE/2026-09-03/files-depth4.json", '{"changed":1}\n');
    put(root, "samples/captures/mcp/2026-09-03/12-34.json", '{"changed":1}\n');
    expect(manifestDiff(root)).toEqual([]);
  });

  it("detects a deleted reference during --check", () => {
    const root = tree();
    lock(root);
    const manifest = JSON.parse(readFileSync(join(root, "samples/manifest.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(manifest)).toContain("samples/button/reference/css/tokens.css");
    writeFileSync(join(root, "samples/button/reference/css/tokens.css"), ":root{--a:1}\n");
    expect(manifestDiff(root)).toEqual(["samples/button/reference/css/tokens.css"]);
  });
});
