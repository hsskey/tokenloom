// encoding scope. `samples/captures/` is exempt because it preserves response bytes verbatim. The same
// bytes must still violate the rule elsewhere so the exemption cannot weaken the rest of the tree.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encoding } from "../src/gates/static";
import type { VerifyContext, VerifyConfig } from "../src/verify-context";

/** The encoding gate reads only `root` and `files`; other fields satisfy the context type. */
function ctxWith(root: string, files: string[]): VerifyContext {
  const config = {
    minTests: 0, maxFileLines: 0, maxLineChars: 0, maxScriptLines: 0,
    maxRuntimeSec: 600, dependencyAllowlist: [], ruleIds: [], bench: {},
  } satisfies VerifyConfig;
  return { root, config, files };
}

const roots: string[] = [];
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

/** Creates one temporary root and removes all created roots when the file completes. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tl-g12-"));
  roots.push(root);
  return root;
}

function writeBytes(root: string, rel: string, buf: Buffer): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

/** Writes JSON without a final newline, matching real raw-capture bytes. */
function writeNoNewline(root: string, rel: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{"comments":[]}');
}

describe("encoding gate: scope (docs/reference/verification.md)", () => {
  it("allows files without final newlines under samples/captures", async () => {
    const root = tempRoot();
    const rel = "samples/captures/rest/KEY/2026-09-05/comments.json";
    writeNoNewline(root, rel);
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({ pass: true, violations: [] });
  });

  it("reports the same bytes outside captures as a missing final newline", async () => {
    const root = tempRoot();
    const rel = "samples/real-design-system/snapshot.json";
    writeNoNewline(root, rel);
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({
      pass: false, reason: `no trailing newline ${rel}`,
    });
  });

  it("allows NUL bytes under samples/captures", async () => {
    const root = tempRoot();
    const rel = "samples/captures/rest/KEY/2026-09-05/comments.json";
    writeBytes(root, rel, Buffer.from("{\"raw\":\"\0\"}\n", "utf8"));
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({ pass: true, nul: 0 });
  });

  it("allows double-encoded lines under verify/selftest", async () => {
    const root = tempRoot();
    const rel = "verify/selftest/encoding/double-encoded/apply/docs/reference/double-encoded-sample.md";
    const broken = Buffer.from("깨진 줄", "utf8").toString("latin1");
    writeBytes(root, rel, Buffer.from(`${broken}\n`, "utf8"));
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({ pass: true, doubleEncoded: 0 });
  });
});
