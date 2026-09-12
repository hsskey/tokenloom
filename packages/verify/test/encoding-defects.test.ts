// Encoding defects: NUL bytes and line-level double encoding (docs/reference/verification.md).
// Neither is exposed by iconv or visual inspection: NUL is invisible, while a double-encoded line
// is itself valid UTF-8 and therefore produces no decoder error.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encoding, isDoubleEncoded } from "../src/gates/static";
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

/**
 * Reinterprets valid UTF-8 as Latin-1 to reproduce the real double-encoding path rather than
 * approximating the defect with hand-written escapes.
 */
function doubleEncode(line: string): string {
  return Buffer.from(line, "utf8").toString("latin1");
}

const KOREAN = "/** 실제 호출만 집계한다. fake 줄이 섞이면 숫자가 오염된다. */";

describe("isDoubleEncoded (docs/reference/verification.md)", () => {
  it("accepts valid Korean whose bytes do not complete the double-encoding round trip", () => {
    expect(isDoubleEncoded(KOREAN)).toBe(false);
  });

  it("detects the same line after it is reinterpreted as Latin-1", () => {
    expect(isDoubleEncoded(doubleEncode(KOREAN))).toBe(true);
  });

  it("accepts ASCII because it contains no Latin-1-range characters", () => {
    expect(isDoubleEncoded("const total = rows.length;")).toBe(false);
  });

  it("accepts accented French text", () => {
    expect(isDoubleEncoded("// résumé de la génération des jetons")).toBe(false);
  });

  it("accepts German text containing umlauts and eszett", () => {
    expect(isDoubleEncoded("// Größe der Ausgabe für die Prüfung")).toBe(false);
  });

  it("detects an ASCII line quoting mojibake as the known false-positive class", () => {
    expect(isDoubleEncoded(`// mojibake looks like ${doubleEncode("한글")} in a diff`)).toBe(true);
  });

  it("exempts a line with a reasoned trailing encoding-ok marker", () => {
    const quoted = `${doubleEncode(KOREAN)} // encoding-ok: 깨진 바이트를 일부러 싣는 표본`;
    expect(isDoubleEncoded(quoted)).toBe(false);
  });

  it("rejects an encoding-ok marker with an empty reason", () => {
    expect(isDoubleEncoded(`${doubleEncode(KOREAN)} // encoding-ok: `)).toBe(true);
  });
});

describe("encoding gate: NUL bytes (docs/reference/verification.md)", () => {
  it("fails with the file name when any NUL byte exists", async () => {
    const root = tempRoot();
    const rel = "packages/eval/src/stats.ts";
    writeBytes(root, rel, Buffer.from("const sep = \"\0\";\n", "utf8"));
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({
      pass: false, reason: `NUL ${rel}`, nul: 1,
    });
  });

  it("passes after removing only the NUL byte from the same line", async () => {
    const root = tempRoot();
    const rel = "packages/eval/src/stats.ts";
    writeBytes(root, rel, Buffer.from("const sep = \"\";\n", "utf8"));
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({ pass: true, nul: 0 });
  });
});

describe("encoding gate: line-level double encoding (docs/reference/verification.md)", () => {
  it("fails with the file and line number for a double-encoded line", async () => {
    const root = tempRoot();
    const rel = "packages/eval/src/stats.ts";
    writeBytes(root, rel, Buffer.from(`${KOREAN}\n${doubleEncode(KOREAN)}\n`, "utf8"));
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({
      pass: false, reason: `DOUBLE-ENCODED ${rel}:2`, doubleEncoded: 1,
    });
  });

  it("finds a broken line mixed with valid Korean in one file", async () => {
    const root = tempRoot();
    const rel = "packages/eval/src/stats.ts";
    const body = [KOREAN, "const rows = [];", doubleEncode(KOREAN), KOREAN].join("\n");
    writeBytes(root, rel, Buffer.from(`${body}\n`, "utf8"));
    expect(await encoding(ctxWith(root, [rel]))).toMatchObject({
      pass: false, reason: `DOUBLE-ENCODED ${rel}:3`, doubleEncoded: 1,
    });
  });
});

describe("encoding gate: detail (docs/reference/verification.md verify.json schema)", () => {
  it("counts both defect types independently in the same tree", async () => {
    const root = tempRoot();
    writeBytes(root, "a.ts", Buffer.from("const sep = \"\0\";\n", "utf8"));
    writeBytes(root, "b.ts", Buffer.from(`${doubleEncode(KOREAN)}\n`, "utf8"));
    expect(await encoding(ctxWith(root, ["a.ts", "b.ts"]))).toMatchObject({
      pass: false, crlf: 0, nul: 1, doubleEncoded: 1,
    });
  });

  it("passes with all three counters at zero when no defect exists", async () => {
    const root = tempRoot();
    writeBytes(root, "a.ts", Buffer.from(`${KOREAN}\n`, "utf8"));
    expect(await encoding(ctxWith(root, ["a.ts"]))).toMatchObject({
      pass: true, crlf: 0, nul: 0, doubleEncoded: 0, violations: [],
    });
  });
});
