/**
 * Reference lock. `--check` compares a recalculated manifest; `--reason` updates it and appends CHANGES.md.
 * This script is the only allowed reference-update path (docs/reference/verification.md section 4).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stableJsonFile } from "../packages/schema/src/stable";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST = join(ROOT, "samples/manifest.json");
const CHANGES = join(ROOT, "samples/CHANGES.md");
const EXIT_USAGE = 1;
const EXIT_MISMATCH = 4;

// Lock expected values only (docs/reference/verification.md section 4). Captures are evidence rather than references; locking
// them would make each sync require relocking and could hide a real reference change in capture churn.
// Exclusions remain tracked by git: capture trees, snapshot.rest.json, and Markdown under samples.
export const LOCKED_PATTERNS = [
  "samples/*/snapshot.json",
  "samples/*/reference/**",
  "samples/*/render/**",
  "samples/mutations/**",
  "eval/thresholds.json",
];

/** `*` matches one segment; `**` matches one or more remaining segments. */
export function isLocked(rel: string, patterns = LOCKED_PATTERNS): boolean {
  return patterns.some((pattern) => {
    const pat = pattern.split("/");
    const seg = rel.split("/");
    for (let i = 0; i < pat.length; i += 1) {
      if (pat[i] === "**") return seg.length > i;
      if (i >= seg.length || (pat[i] !== "*" && pat[i] !== seg[i])) return false;
    }
    return pat.length === seg.length;
  });
}

export function lockedFiles(root = ROOT): string[] {
  const out: string[] = [];
  for (const top of ["samples", "eval"]) walk(join(root, top), root, out);
  return out.filter((rel) => isLocked(rel)).sort();
}

function walk(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative(root, full);
    if (statSync(full).isDirectory()) walk(full, root, out);
    else out.push(rel);
  }
}

export function hashFile(path: string): string {
  return "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function computeManifest(root = ROOT): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rel of lockedFiles(root)) entries[rel] = hashFile(join(root, rel));
  return entries;
}

export function readManifest(root = ROOT): Record<string, string> {
  const path = join(root, "samples/manifest.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

/** Returns paths added, deleted, or modified relative to the manifest. */
export function manifestDiff(root = ROOT): string[] {
  const now = computeManifest(root);
  const before = readManifest(root);
  const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
  return [...keys].filter((k) => now[k] !== before[k]).sort();
}

/** `--only contentHash`: whether only source.contentHash differs in persisted context.compact.json. */
function onlyContentHashChanged(rel: string, root: string): boolean {
  if (!rel.endsWith("context.compact.json")) return false;
  const head = gitShow(rel, root);
  if (head === null) return false;
  const before = JSON.parse(head) as { source?: Record<string, unknown> };
  const after = JSON.parse(readFileSync(join(root, rel), "utf8")) as { source?: Record<string, unknown> };
  if (before.source) before.source.contentHash = "";
  if (after.source) after.source.contentHash = "";
  return stableJsonFile(before) === stableJsonFile(after);
}

function gitShow(rel: string, root: string): string | null {
  const res = spawnSync("git", ["show", `HEAD:${rel}`], { cwd: root, encoding: "utf8" });
  return res.status === 0 ? res.stdout : null;
}

function utcStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  const reasonIdx = argv.indexOf("--reason");
  const reason = reasonIdx >= 0 ? argv[reasonIdx + 1] : undefined;

  if (check) {
    const changed = manifestDiff();
    if (changed.length === 0) return 0;
    process.stderr.write(`reference-lock: manifest mismatch\n${changed.map((c) => `  ${c}`).join("\n")}\n`);
    return EXIT_MISMATCH;
  }
  if (reason === undefined || reason.trim() === "") {
    process.stderr.write("reference-lock: --reason \"<text>\" is required (or --check)\n");
    return EXIT_USAGE;
  }
  const changed = manifestDiff();
  if (only !== undefined) {
    if (only !== "contentHash") {
      process.stderr.write(`reference-lock: unsupported --only ${only}\n`);
      return EXIT_USAGE;
    }
    const violating = changed.filter((rel) => !onlyContentHashChanged(rel, ROOT));
    if (violating.length > 0) {
      process.stderr.write(`reference-lock: --only contentHash rejects\n${violating.map((c) => `  ${c}`).join("\n")}\n`);
      return EXIT_USAGE;
    }
  }
  writeFileSync(MANIFEST, stableJsonFile(computeManifest()));
  const stamp = utcStamp();
  const lines = (changed.length > 0 ? changed : ["(no file change)"]).map((c) => `- ${stamp} ${c} ${reason}\n`);
  appendFileSync(CHANGES, lines.join(""));
  process.stderr.write(`reference-lock: locked ${changed.length} file(s)\n`);
  return 0;
}

if (process.argv[1]?.endsWith("reference-lock.ts") === true) {
  process.exitCode = main(process.argv.slice(2));
}
