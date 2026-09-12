// Verifier self-test. Copies the repository per sample and runs every reachable gate against each copy.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import type { GateIdT, GateResultT } from "@tokenloom/schema";
import { ALL_GATES, pool } from "@tokenloom/schema";
import { spawn, spawnSync } from "node:child_process";
import { fail, ok, type VerifyContext } from "../verify-context";

const SKIP = new Set(["node_modules", ".omc", ".local"]);
/** Sweep knob only. Absent or non-positive keeps the fallback, so the gate contract is unchanged. */
export function resolveSelftestParallel(raw: string | undefined, fallback: number): number {
  const override = Number(raw);
  return Number.isInteger(override) && override > 0 ? override : fallback;
}
/** Sweep knob for copy Vitest workers. Absent or non-positive leaves Vitest's default; host tests are unchanged. */
export function resolveSelftestVitestWorkers(raw: string | undefined): string | undefined {
  const override = Number(raw);
  return Number.isInteger(override) && override > 0 ? String(override) : undefined;
}
/** Child env for one copy. Host `TOKENLOOM_VITEST_WORKERS` must not leak in either direction. */
export function selftestCopyEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, TOKENLOOM_LLM: "fake", NO_COLOR: "1" };
  const workers = resolveSelftestVitestWorkers(base.TOKENLOOM_SELFTEST_VITEST_WORKERS);
  if (workers !== undefined) env.TOKENLOOM_VITEST_WORKERS = workers;
  else delete env.TOKENLOOM_VITEST_WORKERS;
  return env;
}
const PARALLEL = resolveSelftestParallel(process.env.TOKENLOOM_SELFTEST_PARALLEL, 4); // 4-vCPU CI oversubscribes a wider pool

function selftestConcurrency(): { copyPool: number; copyVitestWorkers: string | null } {
  return {
    copyPool: PARALLEL,
    copyVitestWorkers: resolveSelftestVitestWorkers(process.env.TOKENLOOM_SELFTEST_VITEST_WORKERS) ?? null,
  };
}
/**
 * Timing and heap gates contaminate each other when run concurrently, so copies exercising them run
 * one at a time. Serializing preserves the thresholds instead of loosening them for a noisy run.
 */
const SERIAL_GATES = new Set<string>(["benchmarks"]);
const TIMED_STAGES = ["baselinePrepareMs", "baselineGatesMs", "samplePrepareMs", "parallelGatesMs", "serialBenchmarkMs"];

/** Observational wall-clock splits. No self-test verdict reads these. */
export function selftestTiming(marks: number[]): Record<string, number> {
  const at = (index: number): number => marks[index] ?? 0;
  const stages = TIMED_STAGES.slice(0, Math.max(0, marks.length - 1));
  const split = stages.map((stage, index): [string, number] => [stage, at(index + 1) - at(index)]);
  return { ...Object.fromEntries(split), totalMs: at(stages.length) - at(0) };
}

export interface Sample {
  gate: GateIdT;
  name: string;
  dir: string;
}

export function listSamples(root: string): Sample[] {
  const base = join(root, "verify/selftest");
  if (!existsSync(base)) return [];
  const out: Sample[] = [];
  for (const gate of readdirSync(base).sort()) {
    const gateDir = join(base, gate);
    if (!ALL_GATES.includes(gate as GateIdT) || !lstatSync(gateDir).isDirectory()) continue;
    for (const name of readdirSync(gateDir).sort()) {
      if (!lstatSync(join(gateDir, name)).isDirectory()) continue;
      out.push({ gate: gate as GateIdT, name, dir: join(gateDir, name) });
    }
  }
  return out;
}

function workspaceMap(root: string): Map<string, string> {
  const dirs = ["apps/cli"];
  for (const name of readdirSync(join(root, "packages"))) {
    if (name === "adapters") {
      for (const sub of readdirSync(join(root, "packages/adapters"))) dirs.push(`packages/adapters/${sub}`);
    } else dirs.push(`packages/${name}`);
  }
  const map = new Map<string, string>();
  for (const dir of dirs) {
    const pkgPath = join(root, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (pkg.name !== undefined) map.set(pkg.name, dir);
  }
  return map;
}

/** Link node_modules, then retarget `@tokenloom/*` so copy tests cannot import original source. */
function copyRepo(root: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(root)) {
    if (SKIP.has(name)) continue;
    // Link a .git directory for read-only commands; a worktree .git file is copied as-is.
    if (name === ".git" && lstatSync(join(root, name)).isDirectory()) {
      symlinkSync(join(root, name), join(dest, name), "dir");
      continue;
    }
    cpSync(join(root, name), join(dest, name), { recursive: true, dereference: false });
  }
  rmSync(join(dest, "verify/selftest"), { recursive: true, force: true });
  mkdirSync(join(dest, "verify/selftest"), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dest, "node_modules"), "dir");
  const map = workspaceMap(root);
  for (const dir of map.values()) {
    const scoped = join(root, dir, "node_modules", "@tokenloom");
    if (!existsSync(scoped)) continue;
    const target = join(dest, dir, "node_modules", "@tokenloom");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const dep of readdirSync(scoped)) {
      const depDir = map.get(`@tokenloom/${dep}`);
      if (depDir !== undefined) symlinkSync(join(dest, depDir), join(target, dep), "dir");
    }
  }
}

function applySample(sample: Sample, dest: string): void {
  const applyDir = join(sample.dir, "apply");
  if (existsSync(applyDir)) {
    for (const entry of readdirSync(applyDir)) {
      cpSync(join(applyDir, entry), join(dest, entry), { recursive: true, force: true });
    }
  }
  const removeList = join(sample.dir, "remove.txt");
  if (existsSync(removeList)) {
    for (const line of readFileSync(removeList, "utf8").split("\n")) {
      const rel = line.trim();
      if (rel !== "") rmSync(join(dest, rel), { recursive: true, force: true });
    }
  }
}

export interface MetaCase {
  gate: string;
  sample: string;
  asExpected: boolean;
  detail: string;
}

/** Child process per copy: several gates shell out synchronously and cannot share a process. */
function runCopy(dir: string, gates: GateIdT[]): Promise<Record<string, GateResultT>> {
  return new Promise((resolve) => {
    const child = spawn("node", [
      join(dir, "node_modules/tsx/dist/cli.mjs"),
      join(dir, "packages/verify/src/cli.ts"),
      "--gate", gates.join(","),
    ], { cwd: dir, env: selftestCopyEnv(process.env) });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", () => undefined);
    child.on("close", () => {
      const brace = stdout.indexOf("{");
      if (brace < 0) { resolve(Object.fromEntries(gates.map((g) => [g, { pass: false, reason: "no output" }]))); return; }
      resolve(JSON.parse(stdout.slice(brace)) as Record<string, GateResultT>);
    });
  });
}

function prepare(root: string, dest: string, sample?: Sample): void {
  copyRepo(root, dest);
  if (sample !== undefined) applySample(sample, dest);
  spawnSync("node", [join(dest, "node_modules/tsx/dist/cli.mjs"), join(dest, "scripts/build.ts")], { cwd: dest });
}

function lines(dir: string, name: string): string[] {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
}

const PRODUCTION_SRC = /^(?:packages\/adapters\/[^/]+|packages\/[^/]+|apps\/[^/]+)\/src(?:\/|$)/;
const posixPath = (path: string): string => normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");

export function touchesProductionSrc(paths: string[]): boolean {
  return paths.some((path) => PRODUCTION_SRC.test(posixPath(path)));
}

function overlayPaths(sample: Sample): string[] {
  const applyDir = join(sample.dir, "apply");
  const applied = existsSync(applyDir)
    ? readdirSync(applyDir, { encoding: "utf8", recursive: true })
      .filter((rel) => lstatSync(join(applyDir, rel)).isFile())
    : [];
  return [...applied, ...lines(sample.dir, "remove.txt")];
}

type OverlayKind =
  | "productionSrc" | "test" | "sample" | "manifest" | "script" | "bench" | "rootTs"
  | "testObservedDoc" | "doc" | "github" | "verifyRecord" | "unknown";

/** First match wins; unclassified paths stay unknown so coverage fails closed. */
const KIND_RULES: ReadonlyArray<readonly [OverlayKind, (rel: string) => boolean]> = [
  ["productionSrc", (rel) => PRODUCTION_SRC.test(rel)],
  ["test", (rel) => /(?:^|\/)test\/|\.test\.ts$|\.bench\.ts$/.test(rel)],
  ["sample", (rel) => /^samples(?:\/|$)/.test(rel)],
  ["manifest", (rel) => /(^|\/)(package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json)$/.test(rel)],
  ["script", (rel) => /^scripts(?:\/|$)/.test(rel)],
  ["bench", (rel) => /^bench(?:\/|$)/.test(rel)],
  ["testObservedDoc", (rel) => /^docs\/reference\/(verification|spec)\.md$/.test(rel)],
  ["doc", (rel) => /^docs(?:\/|$)/.test(rel) || /^(README|LICENSE|CONTEXT|AGENTS|CLAUDE)/.test(rel)],
  ["github", (rel) => /^\.github(?:\/|$)/.test(rel)],
  ["verifyRecord", (rel) => /^verify(?:\/|$)/.test(rel)],
  ["rootTs", (rel) => /^[^/]+\.ts$/.test(rel)],
];

function overlayKind(path: string): OverlayKind {
  const rel = posixPath(path);
  return KIND_RULES.find(([, matches]) => matches(rel))?.[0] ?? "unknown";
}

const TYPE_KINDS = new Set<OverlayKind>(["productionSrc", "test", "script", "bench", "rootTs", "manifest"]);
const TEST_KINDS = new Set<OverlayKind>([...TYPE_KINDS, "sample", "testObservedDoc", "github", "verifyRecord"]);
const CLI_KINDS = new Set<OverlayKind>(["productionSrc", "sample", "script"]);
const KIND_GATES: Partial<Record<GateIdT, Set<OverlayKind>>> = {
  types: TYPE_KINDS,
  tests: TEST_KINDS,
  reference: CLI_KINDS,
  determinism: CLI_KINDS,
  mutations: CLI_KINDS,
};

function observesGate(gate: GateIdT, paths: string[]): boolean {
  const kinds = paths.map(overlayKind);
  if (kinds.includes("unknown")) return true;
  const allowed = KIND_GATES[gate];
  if (allowed !== undefined) return kinds.some((kind) => allowed.has(kind));
  const src = kinds.includes("productionSrc");
  if (gate === "properties") return src || paths.some((path) => /\.props\.test\.ts$/.test(posixPath(path)));
  if (gate === "rules") return src || paths.some((path) => /\.rules\.test\.ts$/.test(posixPath(path)));
  if (gate === "benchmarks") return src;
  if (gate === "scoring") return paths.some((path) => /^(packages\/eval|reports)(?:\/|$)/.test(posixPath(path)));
  return true;
}

export interface GateSkip { gate: GateIdT; reason: string }

/** Owner plus gates the overlay can change. Unclassified paths run every required gate. */
export function reachableGates(owner: GateIdT, paths: string[], required: GateIdT[]): { run: GateIdT[]; skipped: GateSkip[] } {
  const run = required.filter((gate) => gate === owner || observesGate(gate, paths));
  return { run, skipped: required.filter((g) => !run.includes(g)).map((gate) => ({ gate, reason: "unreachable" })) };
}

export const sampleReachableGates = (sample: Sample, required: GateIdT[]) =>
  reachableGates(sample.gate, overlayPaths(sample), required);

/** Benchmarks measure time and heap; docs/samples/manifest/test-only overlays cannot move them. */
export function runsBenchmarks(sample: Sample): boolean {
  return reachableGates(sample.gate, overlayPaths(sample), ["benchmarks"]).run.includes("benchmarks");
}

export const skipsBenchmarksByScope = (sample: Sample): boolean => !runsBenchmarks(sample);

const expectAlso = (sample: Sample): string[] => lines(sample.dir, "expect-also.txt");

export interface ScopedSamples {
  run: Sample[];
  coverage: Record<string, number>;
  coverageWarnings: string[];
}

/** Every sample runs; coverage records which gates a defect sample actually exercises. */
export function scopeSamples(samples: Sample[], gates: GateIdT[]): ScopedSamples {
  const coverage = Object.fromEntries(gates.map((g) => [g, samples.filter((s) => s.gate === g).length]));
  return { run: samples, coverage, coverageWarnings: gates.filter((g) => coverage[g] === 0) };
}

export async function selftest(ctx: VerifyContext): Promise<GateResultT> {
  const required: GateIdT[] = ALL_GATES.filter((g) => g !== "selftest");
  const samples = listSamples(ctx.root).filter((s) => required.includes(s.gate));
  const missing = required.filter((g) => !samples.some((s) => s.gate === g));
  if (samples.length === 0) return fail("no selftest samples", { samples: 0, asExpected: 0 });
  if (missing.length > 0) return fail(`no selftest sample for ${missing.join(",")}`, { samples: samples.length, missing });
  const scoped = scopeSamples(samples, required);

  const workdir = join(tmpdir(), `tl-selftest-${process.pid}`);
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });

  const startedAt = Date.now();
  const baselineDir = join(workdir, "baseline");
  prepare(ctx.root, baselineDir);
  const baselinePreparedAt = Date.now();
  const baseline = await runCopy(baselineDir, required);
  const baselineGatedAt = Date.now();
  const baselineFails = required.filter((g) => baseline[g]?.pass !== true);
  if (baselineFails.length > 0) {
    const first = baselineFails[0] as string;
    return fail(`clean copy fails ${first}: ${String(baseline[first]?.reason ?? "")}`, {
      samples: samples.length, baselineFails,
      timing: selftestTiming([startedAt, baselinePreparedAt, baselineGatedAt]), ...selftestConcurrency(),
    });
  }

  const prepared = scoped.run.map((sample) => {
    const dest = join(workdir, `${sample.gate}-${sample.name}`);
    prepare(ctx.root, dest, sample);
    const { run, skipped } = sampleReachableGates(sample, required);
    return {
      sample, dest, skipped,
      parallel: run.filter((g) => !SERIAL_GATES.has(g)),
      serial: run.filter((g) => SERIAL_GATES.has(g)),
    };
  });
  const samplesPreparedAt = Date.now();
  const parallelResults = await pool(prepared, PARALLEL, ({ dest, parallel }) => (
    parallel.length === 0 ? Promise.resolve({}) : runCopy(dest, parallel)
  ));
  const parallelGatedAt = Date.now();
  const allResults: Record<string, GateResultT>[] = [];
  for (const [step, parallel] of prepared.map((step, index) => [step, parallelResults[index] ?? {}] as const)) {
    const serial = step.serial.length === 0 ? {} : await runCopy(step.dest, step.serial);
    allResults.push({ ...parallel, ...serial });
  }
  const serialGatedAt = Date.now();

  const cases = prepared.map(({ sample, skipped }, index): MetaCase => {
    const results = allResults[index] ?? {};
    const excused = new Set<string>([sample.gate, ...expectAlso(sample), ...skipped.map((row) => row.gate)]);
    const collateral = required.filter((g) => !excused.has(g) && results[g]?.pass !== true);
    const ownerFailed = results[sample.gate]?.pass === false;
    const asExpected = ownerFailed && collateral.length === 0;
    let detail = "ok";
    if (!ownerFailed) detail = `${sample.gate} did not fail`;
    else if (collateral.length > 0) {
      detail = `collateral damage: ${collateral.map((g) => `${g}(${String(results[g]?.reason ?? "?")})`).join("; ")}`;
    }
    return { gate: sample.gate, sample: sample.name, asExpected, detail };
  });

  rmSync(workdir, { recursive: true, force: true });
  const bad = cases.filter((c) => !c.asExpected);
  const skippedGates = prepared.flatMap(({ sample, skipped }) =>
    skipped.map((row) => ({ sample: `${sample.gate}/${sample.name}`, gate: row.gate, reason: row.reason })));
  const detail = {
    samples: cases.length,
    asExpected: cases.length - bad.length,
    failures: bad,
    coverage: scoped.coverage,
    coverageWarnings: scoped.coverageWarnings,
    notRunByScope: prepared.filter((p) => p.skipped.some((row) => row.gate === "benchmarks"))
      .map((p) => `${p.sample.gate}/${p.sample.name}`),
    skippedGates,
    timing: selftestTiming([startedAt, baselinePreparedAt, baselineGatedAt, samplesPreparedAt, parallelGatedAt, serialGatedAt]),
    ...selftestConcurrency(),
  };
  return bad.length === 0 ? ok(detail) : fail(`${bad[0]?.gate}/${bad[0]?.sample}: ${bad[0]?.detail}`, detail);
}
