import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { GateResultT } from "@tokenloom/schema";

// `.local` holds a developer's own untracked notes. Gates judge the repository, so a scratch file
// there must not fail one; the directory is absent from a fresh clone either way.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".tokenloom", ".omc", ".local"]);

export interface VerifyConfig {
  minTests: number;
  maxFileLines: number;
  maxLineChars: number;
  maxScriptLines: number;
  maxRuntimeSec: number;
  dependencyAllowlist: string[];
  ruleIds: string[];
  bench: Record<string, number | number[]>;
}

export interface VerifyContext {
  root: string;
  config: VerifyConfig;
  /** Root-relative repository files excluding node_modules, dist, and .git. */
  files: string[];
}

export type Gate = (ctx: VerifyContext) => Promise<GateResultT>;

export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out;
}

export function makeVerifyContext(root: string): VerifyContext {
  const config = JSON.parse(readFileSync(join(root, "packages/verify/config.json"), "utf8")) as VerifyConfig;
  return { root: resolve(root), config, files: listFiles(root) };
}

export function read(ctx: VerifyContext, rel: string): string {
  return readFileSync(join(ctx.root, rel), "utf8");
}

export function has(ctx: VerifyContext, rel: string): boolean {
  return existsSync(join(ctx.root, rel));
}

/** `**` crosses path separators while `*` does not. */
export function globToRegExp(pattern: string): RegExp {
  let body = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i] as string;
    if (c === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") { body += "(?:.*/)?"; i += 2; } else { body += ".*"; i += 1; }
      continue;
    }
    if (c === "*") { body += "[^/]*"; continue; }
    if (c === "?") { body += "[^/]"; continue; }
    body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${body}$`);
}

export function matchFiles(ctx: VerifyContext, include: string[], exclude: string[] = []): string[] {
  const inc = include.map(globToRegExp);
  const exc = exclude.map(globToRegExp);
  return ctx.files.filter((f) => inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f)));
}

/** LOC scope: non-test TypeScript under packages/**\/src and apps/**\/src. */
export function sourceFiles(ctx: VerifyContext): string[] {
  return matchFiles(ctx, ["packages/**/src/**/*.ts", "apps/**/src/**/*.ts"], ["**/*.test.ts", "**/*.bench.ts"]);
}

export function scriptFiles(ctx: VerifyContext): string[] {
  return matchFiles(ctx, ["scripts/**/*.ts"]);
}

/** Gate runs write eval records here so a verification run never appends to the repository's committed runs/. */
const RUNS_DIR = mkdtempSync(join(tmpdir(), "tl-verify-runs-"));

export function sh(
  ctx: VerifyContext,
  cmd: string,
  args: string[],
  timeoutMs = 600_000,
  env: Record<string, string> = {},
): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, {
    cwd: ctx.root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TOKENLOOM_LLM: "fake", NO_COLOR: "1", TOKENLOOM_RUNS_DIR: RUNS_DIR, ...env },
  });
}

export function git(ctx: VerifyContext, args: string[]): string {
  const res = sh(ctx, "git", args);
  return res.status === 0 ? res.stdout : "";
}

export function fail(reason: string, extra: Record<string, unknown> = {}): GateResultT {
  return { pass: false, reason, ...extra };
}

export function ok(extra: Record<string, unknown> = {}): GateResultT {
  return { pass: true, ...extra };
}

