// Type safety, forbidden patterns, source scope, and file encoding. Raw-byte captures are excluded.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateResultT } from "@tokenloom/schema";
import { fail, matchFiles, ok, read, scriptFiles, sh, sourceFiles, type VerifyContext } from "../verify-context";

interface PatternSpec {
  id: string;
  regex: string;
  include: string[];
  exclude: string[];
  reason: string;
}
interface PatternsFile {
  patterns: PatternSpec[];
  weakMatchers: string[];
  weakScope: string[];
  /** Type-bypass detection patterns kept indirect so the type gate does not flag its own source. */
  typeEscapes: { anyAnnotation: string; asAny: string; tsIgnore: string; tsExpectError: string; maxAsAny: number };
}

function loadPatterns(ctx: VerifyContext): PatternsFile {
  return JSON.parse(readFileSync(join(ctx.root, "packages/verify/patterns.json"), "utf8")) as PatternsFile;
}

function count(text: string, source: string): number {
  return text.match(new RegExp(source, "g"))?.length ?? 0;
}

export async function types(ctx: VerifyContext): Promise<GateResultT> {
  const escapes = loadPatterns(ctx).typeEscapes;
  const res = sh(ctx, "node", ["node_modules/typescript/bin/tsc", "--noEmit"]);
  // The plugin has isolated Figma typings, so typecheck both programs separately.
  const pluginProject = "packages/adapters/plugin/tsconfig.json";
  const plugin = sh(ctx, "node", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", pluginProject]);
  const output = `${res.stdout}${res.stderr}${plugin.stdout}${plugin.stderr}`;
  const errors = output.split("\n").filter((l) => /error TS\d+/.test(l)).length;
  const totals = { anyCount: 0, asAny: 0, tsIgnore: 0, tsExpect: 0 };
  for (const rel of sourceFiles(ctx)) {
    const text = read(ctx, rel);
    totals.anyCount += count(text, escapes.anyAnnotation);
    totals.asAny += count(text, escapes.asAny);
    totals.tsIgnore += count(text, escapes.tsIgnore);
    totals.tsExpect += count(text, escapes.tsExpectError);
  }
  const detail = { errors, ...totals };
  if (errors > 0) return fail(output.split("\n").filter((l) => l.includes("error TS"))[0] ?? "tsc failed", detail);
  if (totals.anyCount > 0) return fail("explicit any annotation is not allowed", detail);
  if (totals.asAny > escapes.maxAsAny) return fail(`as-any casts exceed ${escapes.maxAsAny}`, detail);
  if (totals.tsIgnore > 0 || totals.tsExpect > 0) return fail("ts suppression comment is not allowed", detail);
  return ok(detail);
}

function weakTestViolations(ctx: VerifyContext, spec: PatternsFile): string[] {
  const out: string[] = [];
  for (const rel of matchFiles(ctx, spec.weakScope)) {
    const text = read(ctx, rel);
    for (const block of text.split(/\n\s*it\(/).slice(1)) {
      const body = block.split(/\n\s*\}\);/)[0] ?? "";
      const asserts = body.match(/expect\([\s\S]*?\)\.[A-Za-z.]+\(/g) ?? [];
      if (asserts.length === 0) continue;
      const strong = asserts.filter((a) => !spec.weakMatchers.some((w) => a.endsWith(w.replace(/\(\)$/, "("))));
      if (strong.length === 0) out.push(`${rel}: weak assertions only`);
    }
  }
  return out;
}

export async function patterns(ctx: VerifyContext): Promise<GateResultT> {
  const spec = loadPatterns(ctx);
  const violations: string[] = [];
  for (const p of spec.patterns) {
    const re = new RegExp(p.regex, "gm");
    for (const rel of matchFiles(ctx, p.include, [...p.exclude, "verify/selftest/**"])) {
      const text = read(ctx, rel);
      const hits = text.match(re);
      if (hits !== null) violations.push(`${p.id} ${rel} (${hits.length}) ${p.reason}`);
    }
  }
  violations.push(...weakTestViolations(ctx, spec));
  return violations.length === 0 ? ok({ violations }) : fail(violations[0] as string, { violations });
}

function countLoc(ctx: VerifyContext, rels: string[]): number {
  return rels.reduce((sum, rel) => sum + read(ctx, rel).split("\n").filter((l) => l.trim() !== "").length, 0);
}

export async function scope(ctx: VerifyContext): Promise<GateResultT> {
  const src = sourceFiles(ctx);
  const scripts = scriptFiles(ctx);
  const scriptLoc = countLoc(ctx, scripts);
  const longFiles: string[] = [];
  const longLines: string[] = [];
  for (const rel of [...src, ...scripts]) {
    const lines = read(ctx, rel).split("\n");
    if (lines.length > ctx.config.maxFileLines) longFiles.push(`${rel}:${lines.length}`);
    const over = lines.findIndex((l) => l.length > ctx.config.maxLineChars);
    if (over >= 0) longLines.push(`${rel}:${over + 1}`);
  }
  const unlistedDeps: string[] = [];
  const pkgGlobs = ["package.json", "packages/*/package.json", "packages/adapters/*/package.json", "apps/*/package.json"];
  for (const rel of matchFiles(ctx, pkgGlobs)) {
    const pkg = JSON.parse(read(ctx, rel)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    for (const name of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
      if (name.startsWith("@tokenloom/")) continue;
      if (!ctx.config.dependencyAllowlist.includes(name)) unlistedDeps.push(`${rel}: ${name}`);
    }
  }
  const detail = { scriptLoc, files: src.length, unlistedDeps, longFiles, longLines };
  if (scriptLoc > ctx.config.maxScriptLines) return fail(`scripts loc ${scriptLoc} > ${ctx.config.maxScriptLines}`, detail);
  if (longFiles.length > 0) return fail(`file over ${ctx.config.maxFileLines} lines: ${longFiles[0] as string}`, detail);
  if (longLines.length > 0) return fail(`line over ${ctx.config.maxLineChars} chars: ${longLines[0] as string}`, detail);
  if (unlistedDeps.length > 0) return fail(`unlisted dependency: ${unlistedDeps[0] as string}`, detail);
  return ok(detail);
}

const BINARY_EXT = /\.(png|jpg|jpeg|gif|woff2?|ico|br|zst|pdf)$/i;

/**
 * `samples/captures/` preserves response bytes exactly and is exempt from encoding normalization.
 * Adding even a newline would violate the server-byte contract.
 */
const RAW_BYTES_PREFIX = "samples/captures/";

/** Code-point boundaries for the end of ASCII and Latin-1 coverage, not policy thresholds. */
const ASCII_MAX = 0x7f;
const LATIN1_MAX = 0xff;
/** End-of-line exemption marker; a blank reason is invalid, matching the `literal-ok` marker. */
const ENCODING_OK = /encoding-ok: (\S.*)$/;

/**
 * Detects a line produced by reading UTF-8 bytes as Latin-1 and saving them again. Latin-1-only text
 * whose bytes decode as valid UTF-8 reveals prior non-ASCII text. Valid Korean lies above U+00FF,
 * while genuine French or German bytes do not decode as UTF-8 and therefore remain allowed.
 */
export function isDoubleEncoded(line: string): boolean {
  if (ENCODING_OK.test(line)) return false;
  let hasLatin1 = false;
  for (const ch of line) {
    const code = ch.codePointAt(0) as number;
    if (code > LATIN1_MAX) return false;
    if (code > ASCII_MAX) hasLatin1 = true;
  }
  return hasLatin1 && !Buffer.from(line, "latin1").toString("utf8").includes("\ufffd");
}

export async function encoding(ctx: VerifyContext): Promise<GateResultT> {
  const violations: string[] = [];
  let crlf = 0;
  let nul = 0;
  let doubleEncoded = 0;
  for (const rel of ctx.files) {
    if (BINARY_EXT.test(rel) || rel.startsWith("verify/selftest/") || rel.startsWith(RAW_BYTES_PREFIX)) continue;
    const buf = readFileSync(join(ctx.root, rel));
    if (buf.includes(13)) { crlf += 1; violations.push(`CRLF ${rel}`); continue; }
    // NUL survives UTF-8 round trips and is invisible, so it must be detected in bytes.
    if (buf.includes(0)) { nul += 1; violations.push(`NUL ${rel}`); continue; }
    const text = buf.toString("utf8");
    if (Buffer.compare(Buffer.from(text, "utf8"), buf) !== 0) { violations.push(`not UTF-8 ${rel}`); continue; }
    text.split("\n").forEach((line, i) => {
      if (!isDoubleEncoded(line)) return;
      doubleEncoded += 1;
      violations.push(`DOUBLE-ENCODED ${rel}:${i + 1}`);
    });
    if (rel.endsWith(".json") && !text.endsWith("\n")) violations.push(`no trailing newline ${rel}`);
  }
  const detail = { crlf, nul, doubleEncoded, violations };
  return violations.length === 0 ? ok(detail) : fail(violations[0] as string, detail);
}
