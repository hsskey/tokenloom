/**
 * Verifies that the CSS, Swift, and Kotlin outputs expose the same token-name set (rule O05).
 * Accepts the output directory from `tokens build --platform css,swift,kotlin --out <dir>`.
 *
 * Paths in `<dir>/tokens/*.json` are authoritative. CSS variables and Swift/Kotlin members derive
 * mechanically from them, so extracted output names are compared to those derivations. Reverse
 * conversion is ambiguous because member names lose segment boundaries. Backticks and a leading
 * underscore are removed before comparison (docs/reference/spec.md section 4.7.1 (9)).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { categoryKey, cssVarName, memberName, typeName } from "../packages/tokens/src/identifier";

const EXIT_USAGE = 1;
const EXIT_MISMATCH = 4;

/** Flattens a DTCG tree into authoritative paths; leaves contain `$type` and `$value`. */
function paths(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [];
  if ("$type" in node && "$value" in node) return [prefix];
  return Object.entries(node as Record<string, unknown>)
    .flatMap(([k, v]) => paths(v, prefix === "" ? k : `${prefix}.${k}`));
}

function canonicalPaths(dir: string): string[] {
  const tokensDir = join(dir, "tokens");
  if (!existsSync(tokensDir)) return [];
  const all = readdirSync(tokensDir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => paths(JSON.parse(readFileSync(join(tokensDir, f), "utf8"))));
  return [...new Set(all)].sort();
}

function strip(name: string): string {
  return name.replace(/`/g, "").replace(/^_/, "");
}

function found(dir: string, rel: string, pattern: RegExp): Set<string> {
  const path = join(dir, rel);
  if (!existsSync(path)) return new Set();
  const text = readFileSync(path, "utf8");
  return new Set([...text.matchAll(pattern)].map((m) => strip(m[1] as string)));
}

/**
 * Indexes each generated member name back to its authoritative path, mapping `RootToken.scale01` to
 * `scale-01` (rule O08). Reverse conversion from a member alone is ambiguous, so the index is built
 * from the authoritative set. Rule N06 excludes colliding paths, which makes the index injective.
 */
export function memberIndex(canonical: readonly string[]): Map<string, string> {
  return new Map(canonical.map((p) => [`${typeName(categoryKey(p))}.${strip(memberName(p))}`, p]));
}

function compare(label: string, want: Set<string>, got: Set<string>): string[] {
  const missing = [...want].filter((n) => !got.has(n)).sort();
  const extra = [...got].filter((n) => !want.has(n)).sort();
  const out: string[] = [];
  if (missing.length > 0) out.push(`${label}: missing ${missing.join(", ")}`);
  if (extra.length > 0) out.push(`${label}: unexpected ${extra.join(", ")}`);
  return out;
}

export function diffNameSets(dir: string): { count: number; problems: string[] } {
  const canonical = canonicalPaths(dir);
  const problems: string[] = [];
  problems.push(...compare(
    "css",
    new Set(canonical.map(cssVarName)),
    found(dir, "css/tokens.css", /^\s*(--[a-z0-9-]+)\s*:/gm),
  ));
  // Every member name must map back to exactly one authoritative path; a collision is an O05 mismatch.
  const byMember = memberIndex(canonical);
  const shared = canonical.length - byMember.size;
  if (shared > 0) problems.push(`native: ${shared} canonical paths share a Type.member name`);
  const declared = new Set([...byMember.keys()].map((q) => q.split(".")[1] as string));
  problems.push(...compare("swift", declared, found(dir, "swift/Tokens.swift", /^\s*static let (`?_?[A-Za-z0-9_]+`?)\s*:/gm)));
  problems.push(...compare("kotlin", declared, found(dir, "kotlin/Tokens.kt", /^\s*val (`?_?[A-Za-z0-9_]+`?)\s*:/gm)));
  // All three outputs must expose the same category set. Single-segment paths have no category and
  // are grouped under RootToken (rule O08).
  const categories = [...new Set(canonical.map((p) => typeName(categoryKey(p))))].sort();
  for (const [rel, kw] of [["swift/Tokens.swift", "enum"], ["kotlin/Tokens.kt", "object"]] as const) {
    const got = found(dir, rel, new RegExp(`^${kw} ([A-Za-z0-9]+Token) \\{`, "gm"));
    problems.push(...compare(`${rel} types`, new Set(categories), got));
  }
  return { count: canonical.length, problems };
}

function main(argv: string[]): number {
  const dir = argv[0];
  if (dir === undefined) {
    process.stderr.write("token-name-set-diff: <out-dir> is required\n");
    return EXIT_USAGE;
  }
  const { count, problems } = diffNameSets(resolve(dir));
  if (count === 0) {
    process.stderr.write(`token-name-set-diff: no tokens/*.json under ${dir}\n`);
    return EXIT_USAGE;
  }
  if (problems.length > 0) {
    process.stderr.write(`token-name-set-diff: O05 mismatch\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
    return EXIT_MISMATCH;
  }
  process.stderr.write(`token-name-set-diff: ${count} = ${count} = ${count}\n`);
  return 0;
}

if (process.argv[1]?.endsWith("token-name-set-diff.ts") === true) {
  process.exitCode = main(process.argv.slice(2));
}
