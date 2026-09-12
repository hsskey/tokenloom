// docs/reference/spec.md section 4.9: sync, budget, sample refresh, and sample diff.
// Network access stays in @tokenloom/rest; this module coordinates budgets, paths, and output.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { SnapshotT } from "@tokenloom/schema";
import { Snapshot, stableJsonFile, stableStringify } from "@tokenloom/schema";
import { cacheFileName, compress } from "@tokenloom/cache";
import {
  createFileBudget, createHttpDeps, rateLimitHeaders, restCapturePath, syncSnapshot, tightest,
  type BudgetConfig, type ResponseHeaders,
} from "@tokenloom/rest";
import config from "../../../tokenloom.config";
import { EXIT, flagBool, flagString, usageError, type Parsed } from "./args";
import { repoRoot } from "./runs";
import { appendRun } from "./runs";

// Configuration overrides the plan-selected windows and caps in the docs/reference/spec.md section 0
// matrix (docs/reference/spec.md section 4.10).
const BUDGET_CONFIG: BudgetConfig = config.budget;

function ledgerOrExit(root: string): { ok: true; budget: ReturnType<typeof createFileBudget> } | number {
  const created = createFileBudget(root, config.plan, BUDGET_CONFIG, Date.now);
  if (!created.ok) {
    process.stderr.write(`budget: ${created.reason}\n`);
    return EXIT.network;
  }
  return { ok: true, budget: created };
}

export function cmdBudget(parsed: Parsed): number {
  const root = repoRoot(process.cwd());
  const created = ledgerOrExit(root);
  if (typeof created === "number") return created;
  const rows = created.budget.ok ? created.budget.budget.current() : null;
  if (rows === null) return EXIT.network;
  // A scope can have several windows, so emit one row per window.
  for (const row of rows) {
    process.stderr.write(
      `budget ${config.plan}: ${row.scope} per ${row.per} ${row.used}/${row.cap} (reserve ${row.reserve})\n`,
    );
  }
  if (flagBool(parsed, "json")) process.stdout.write(stableJsonFile({ plan: config.plan, windows: rows }));
  return EXIT.ok;
}

function tokenOrUsage(): string | null {
  const token = process.env.FIGMA_TOKEN;
  return token === undefined || token === "" ? null : token;
}

/** Preserve response bytes to diagnose missing fields without spending another Tier 1 call. */
function writeRaw(root: string, fileKey: string, endpoint: string, body: string): string {
  const rel = restCapturePath(fileKey, new Date().toISOString().slice(0, 10), endpoint);
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
  return rel;
}

/** Save available rate-limit headers beside responses; report missing headers on stderr without empty files. */
function writeHeaders(root: string, fileKey: string, endpoint: string, headers: ResponseHeaders): void {
  const limits = rateLimitHeaders(headers);
  const names = Object.keys(limits);
  const shown = names.length === 0 ? "none" : names.map((n) => `${n}=${limits[n] as string}`).join(" ");
  process.stderr.write(`sync: headers ${endpoint} ${shown}\n`);
  if (names.length > 0) writeRaw(root, fileKey, `${endpoint}.headers`, stableJsonFile(limits));
}

/** Warn before discovery JSON expands into the larger in-memory representation described in docs/reference/spec.md section 2.1. */
export const DISCOVERY_WARN_BYTES = 20 * 1024 * 1024;

/** Keep size classification independent of loading a large saved response. */
export function discoveryWarning(bytes: number): string | null {
  return bytes > DISCOVERY_WARN_BYTES
    ? `sync: discovery response ${bytes}B exceeds ${DISCOVERY_WARN_BYTES}B, expect 6-10x that in heap`
    : null;
}

async function runSync(root: string, fileKey: string, setNames: string[] | undefined, expectSets?: number): Promise<
  { ok: true; snapshot: SnapshotT; tier1Calls: number; discoveryBytes: number; setsFound: number }
  | { ok: false; code: number }
> {
  const token = tokenOrUsage();
  if (token === null) {
    process.stderr.write("sync: FIGMA_TOKEN is required\n");
    return { ok: false, code: EXIT.fatal };
  }
  const created = ledgerOrExit(root);
  if (typeof created === "number") return { ok: false, code: created };
  if (!created.budget.ok) return { ok: false, code: EXIT.network };

  const result = await syncSnapshot({
    http: createHttpDeps(token, config.retryAfterMaxSec),
    budget: created.budget.budget,
    plan: config.plan,
    discoverDepth: config.discoverDepth,
  }, {
    fileKey, setNames, withComments: true, expectSets,
    onRaw: (endpoint, body, headers) => {
      process.stderr.write(`sync: raw ${endpoint} -> ${writeRaw(root, fileKey, endpoint, body)}\n`);
      writeHeaders(root, fileKey, endpoint, headers);
    },
  });

  if (!result.ok) {
    process.stderr.write(`sync: ${result.failure.kind} ${JSON.stringify(result.failure)}\n`);
    return { ok: false, code: EXIT.network };
  }
  const { snapshot, tier1Calls, discoveryBytes, setsFound } = result.value;
  const warning = discoveryWarning(discoveryBytes);
  if (warning !== null) process.stderr.write(`${warning}\n`);
  return { ok: true, snapshot, tier1Calls, discoveryBytes, setsFound };
}

/** docs/reference/spec.md section 4.9 cache path: .tokenloom/cache/<fileKey>/<fileVersion>.snapshot.json.<codec>. */
function writeCache(root: string, fileKey: string, snapshot: SnapshotT): string {
  const path = join(root, ".tokenloom/cache", fileKey, cacheFileName(snapshot.source.fileVersion));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, compress(stableJsonFile(snapshot)));
  return path;
}

export async function cmdSync(parsed: Parsed): Promise<number> {
  const fileKey = flagString(parsed, "file") ?? config.fileKey;
  if (fileKey === undefined) return usageError("sync: --file <fileKey> is required");
  const setsRaw = flagString(parsed, "sets");
  const started = performance.now();
  const root = repoRoot(process.cwd());

  const expectRaw = flagString(parsed, "expect-sets");
  if (expectRaw !== undefined && !Number.isInteger(Number(expectRaw))) {
    return usageError("sync: --expect-sets <n> must be an integer");
  }
  const result = await runSync(
    root, fileKey, setsRaw?.split(",").map((s) => s.trim()),
    expectRaw === undefined ? undefined : Number(expectRaw),
  );
  if (!result.ok) return result.code;

  const cachePath = writeCache(root, fileKey, result.snapshot);
  const ledger = createFileBudget(root, config.plan, BUDGET_CONFIG, Date.now);
  // The tightest Tier 1 window determines whether the next sync can proceed.
  const tier1Window = ledger.ok ? tightest(ledger.budget.current(), "tier1") : null;
  const summary = {
    fileVersion: result.snapshot.source.fileVersion,
    sets: result.snapshot.componentSets.length,
    variables: result.snapshot.variables.length,
    textStyles: result.snapshot.textStyles.length,
    annotations: result.snapshot.annotations.length,
    budget: {
      tier1Used: tier1Window?.used ?? result.tier1Calls,
      tier1Cap: tier1Window?.cap ?? 0,
      tier1Per: tier1Window?.per ?? null,
    },
    ms: Math.round(performance.now() - started),
    discoveryBytes: result.discoveryBytes,
    setsFound: result.setsFound,
  };
  process.stderr.write(
    `sync: ${summary.sets} sets -> ${cachePath}`
    + ` (discovery ${summary.discoveryBytes}B, found ${summary.setsFound})\n`,
  );
  if (flagBool(parsed, "json")) process.stdout.write(stableJsonFile(summary));
  appendRun({
    cmd: "sync", target: fileKey,
    bytesIn: 0, bytesOut: Buffer.byteLength(stableJsonFile(result.snapshot), "utf8"),
    ms: { sync: summary.ms }, warnings: 0,
  });
  return EXIT.ok;
}

export async function cmdSamplesRefresh(parsed: Parsed): Promise<number> {
  const fileKey = flagString(parsed, "file") ?? config.fileKey;
  if (fileKey === undefined) return usageError("samples refresh: --file <fileKey> is required");
  const only = flagString(parsed, "only");
  if (only === undefined) return usageError("samples refresh: --only <name> is required");
  const root = repoRoot(process.cwd());
  const result = await runSync(root, fileKey, undefined);
  if (!result.ok) return result.code;
  const path = join(root, "samples", only, "snapshot.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableJsonFile(result.snapshot));
  process.stderr.write(`samples refresh: ${only} <- ${result.snapshot.componentSets.length} sets\n`);
  return EXIT.ok;
}

/** Report changed field paths to expose response schema drift (docs/reference/spec.md section 8). */
export function fieldDiff(left: unknown, right: unknown, path = ""): string[] {
  if (stableStringify(left, 0) === stableStringify(right, 0)) return [];
  const bothObjects = isRecord(left) && isRecord(right);
  if (!bothObjects) return [path === "" ? "/" : path];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) => fieldDiff(left[key], right[key], `${path}/${key}`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Remove extra before comparison because fieldDiff treats each array as one path. */
function withoutExtra(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutExtra);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "extra").map(([key, v]) => [key, withoutExtra(v)]),
  );
}

/** Exclude adapter metadata so REST ancestor chains do not appear as design changes against plugin exports. */
export function diffPaths(left: unknown, right: unknown): string[] {
  return fieldDiff(withoutExtra(left), withoutExtra(right));
}

/** Record provenance for comparison snapshots that are outside the manifest's reference-file scope. */
export function fileSha256(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

export function cmdSamplesDiff(parsed: Parsed): number {
  const only = flagString(parsed, "only");
  if (only === undefined) return usageError("samples diff: --only <name> is required");
  const root = repoRoot(process.cwd());
  const path = join(root, "samples", only, "snapshot.json");
  const against = flagString(parsed, "against") ?? join(root, "samples", only, "snapshot.rest.json");
  if (!existsSync(path) || !existsSync(against)) {
    return usageError(`samples diff: need both ${path} and ${against}`);
  }
  const left = Snapshot.parse(JSON.parse(readFileSync(path, "utf8")));
  const right = Snapshot.parse(JSON.parse(readFileSync(against, "utf8")));
  const paths = diffPaths(left, right);
  const againstSha256 = fileSha256(against);
  // Repository-relative paths keep stdout bytes identical across machines.
  const againstRel = relative(root, against);
  for (const p of paths) process.stderr.write(`${p}\n`);
  process.stderr.write(`samples diff: ${paths.length} differing field paths (against ${againstSha256})\n`);
  if (flagBool(parsed, "json")) process.stdout.write(stableJsonFile({ against: againstRel, againstSha256, only, paths }));
  return paths.length === 0 ? EXIT.ok : EXIT.reference;
}
