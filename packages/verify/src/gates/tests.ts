// Test-suite health, property execution, rule traceability, and evaluation scoring integrity.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { GateResultT } from "@tokenloom/schema";
import { fail, git, matchFiles, ok, read, sh, type VerifyContext } from "../verify-context";

export interface VitestJson {
  numTotalTests?: number; numFailedTests?: number; numPendingTests?: number; numTodoTests?: number;
  testResults?: { name: string; status: string; assertionResults?: { title: string; status: string }[] }[];
}

interface PropertyEvidence { id: string; runs: number }

/** Provenance, so a gate narrowed to one pattern never inherits another file's failure. */
export interface VitestFile {
  name: string; failed: number; skipped: number; titles: string[]; executedTitles: string[];
}

export interface VitestRun extends Omit<VitestFile, "name"> {
  total: number; passed: number; propertyEvidence: PropertyEvidence[]; files: VitestFile[]; error?: string;
}

function mergeOutcomes(files: VitestFile[]): Omit<VitestFile, "name"> & Pick<VitestRun, "passed"> {
  return {
    passed: files.reduce((n, f) => n + f.titles.length, 0), failed: files.reduce((n, f) => n + f.failed, 0),
    skipped: files.reduce((n, f) => n + f.skipped, 0), titles: files.flatMap((f) => f.titles),
    executedTitles: files.flatMap((f) => f.executedTitles) };
}

/** Vitest titles include skipped/todo cases, so `executedTitles` proves execution; `root` matches filter paths. */
export function collectTitles(
  report: VitestJson, root?: string,
): Omit<VitestFile, "name"> & Pick<VitestRun, "passed"> & { files: VitestFile[] } {
  const files: VitestFile[] = [];
  for (const file of report.testResults ?? []) {
    const name = root === undefined ? file.name : relative(root, file.name);
    const entry: VitestFile = { name, failed: 0, skipped: 0, titles: [], executedTitles: [] };
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === "passed") entry.titles.push(assertion.title);
      if (assertion.status === "passed" || assertion.status === "failed") entry.executedTitles.push(assertion.title);
      if (assertion.status === "failed") entry.failed += 1;
      else if (assertion.status !== "passed") entry.skipped += 1;
    }
    files.push(entry);
  }
  return { ...mergeOutcomes(files), files };
}

/**
 * One full run through Vitest's path-substring filter; evidence and `total` stay whole because the
 * properties gate counts generated cases across the run, while only the tests gate reads `total`.
 */
export function subsetVitestRun(full: VitestRun, pattern: string): VitestRun {
  // Case folding mirrors Vitest's filterFiles path-substring matching.
  const files = full.files.filter((f) => f.name.toLocaleLowerCase().includes(pattern.toLocaleLowerCase()));
  return { ...full, ...mergeOutcomes(files), files };
}

/** Rule IDs with no executed test title, which is the only condition the rules gate rejects. */
export function missingRuleIds(required: string[], executedTitles: string[]): string[] {
  const covered = new Set<string>();
  for (const title of executedTitles) {
    for (const id of required) if (new RegExp(`(^|[^A-Za-z0-9])${id}([^A-Za-z0-9]|$)`).test(title)) covered.add(id);
  }
  return required.filter((id) => !covered.has(id));
}

/**
 * Sweep knob only. Unset leaves Vitest on its own worker default, so no gate outcome moves.
 * Min and max stay equal and in `=` tokens: max alone conflicts with Tinypool's default min, and a
 * following bare token is a file filter. Either way G03 sees zero tests and fails the phase minimum.
 */
export function vitestWorkerArgs(raw: string | undefined): string[] {
  return raw === undefined || raw === "" ? [] : [`--minWorkers=${raw}`, `--maxWorkers=${raw}`];
}

/** Runs Vitest with its JSON reporter without importing target package modules. */
export function runVitest(ctx: VerifyContext, patterns: string[] = []): VitestRun {
  const dir = mkdtempSync(join(tmpdir(), "tl-vitest-"));
  const out = join(dir, "result.json");
  const evidence = join(dir, "property-evidence.jsonl");
  const args = ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${out}`,
    ...vitestWorkerArgs(process.env.TOKENLOOM_VITEST_WORKERS), ...patterns];
  const res = sh(ctx, "node", args, 600_000, { TOKENLOOM_PROPERTY_EVIDENCE: evidence });
  if (!existsSync(out)) {
    const error = `${res.stdout}${res.stderr}`.slice(-2000);
    return { total: 0, passed: 0, failed: 1, skipped: 0, titles: [], executedTitles: [], propertyEvidence: [], files: [], error };
  }
  const report = JSON.parse(readFileSync(out, "utf8")) as VitestJson;
  const { titles, executedTitles, files } = collectTitles(report, ctx.root);
  const propertyEvidence = existsSync(evidence)
    ? readFileSync(evidence, "utf8").split("\n").filter((line) => line !== "")
      .map((line) => JSON.parse(line) as PropertyEvidence)
    : [];
  return {
    total: report.numTotalTests ?? 0, passed: titles.length, failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    titles, executedTitles, propertyEvidence, files,
  };
}

/** Caches by repository root so concurrently evaluated self-test copies stay isolated. */
const cached = new Map<string, VitestRun>();
export function vitestOnce(ctx: VerifyContext): VitestRun {
  const hit = cached.get(ctx.root);
  if (hit !== undefined) return hit;
  const run = runVitest(ctx);
  cached.set(ctx.root, run);
  return run;
}
export function resetVitestCache(root: string): void { cached.delete(root); }

/**
 * Reads the full test run as a narrowed view, avoiding three processes per copy; without a report,
 * a single-gate invocation still runs its own pattern.
 */
function vitestFor(ctx: VerifyContext, pattern: string): VitestRun {
  const full = cached.get(ctx.root);
  return full !== undefined && full.error === undefined ? subsetVitestRun(full, pattern) : runVitest(ctx, [pattern]);
}

export async function tests(ctx: VerifyContext): Promise<GateResultT> {
  const run = vitestOnce(ctx);
  const min = ctx.config.minTests;
  const detail = { tests: run.total, failed: run.failed, skipped: run.skipped, min };
  if (run.error !== undefined) return fail("vitest did not produce a report", { ...detail, error: run.error });
  if (run.failed > 0) return fail(`${run.failed} test(s) failed`, detail);
  if (run.skipped > 0) return fail(`${run.skipped} test(s) skipped`, detail);
  if (run.total < min) return fail(`tests ${run.total} < minimum ${min}`, detail);
  return ok(detail);
}

/** Every property in the specification must execute; see docs/reference/verification.md section 6. */
export const PROPERTY_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09"];

export async function properties(ctx: VerifyContext): Promise<GateResultT> {
  if (matchFiles(ctx, ["**/*.props.test.ts"]).length === 0) {
    return fail("no *.props.test.ts found", { properties: 0 });
  }
  const run = vitestFor(ctx, "props.test");
  const required = PROPERTY_IDS;
  const passedIds = new Set(run.titles.flatMap((title) => title.match(/\bP0[1-9]\b/g) ?? []));
  const observed = new Map(run.propertyEvidence.map(({ id, runs }) => [id, runs]));
  const missing = required.filter((id) => !passedIds.has(id) || !observed.has(id));
  const runsEach = Math.min(...required.map((id) => observed.get(id) ?? 0));
  const short = required.filter((id) => (observed.get(id) ?? 0) < 200);
  const detail = {
    properties: observed.size, runsEach,
    observedRuns: Object.fromEntries([...observed].sort(([a], [b]) => a.localeCompare(b))),
    counterexamples: run.failed, titles: passedIds.size, missing };
  if (missing.length > 0) return fail(`missing executed property ids: ${missing.join(",")}`, detail);
  if (short.length > 0) return fail(`property runs below 200: ${short.join(",")}`, detail);
  if (run.failed > 0) return fail("property test failed", detail);
  return ok(detail);
}

export async function rules(ctx: VerifyContext): Promise<GateResultT> {
  const required = ctx.config.ruleIds;
  const run = vitestFor(ctx, "rules.test");
  const missing = missingRuleIds(required, run.executedTitles);
  const detail = { rules: required.length, covered: required.length - missing.length, failed: run.failed, skipped: run.skipped, missing };
  return missing.length === 0 ? ok(detail) : fail(`missing executed rule ids: ${missing.join(",")}`, detail);
}

const ALLOWED_LITERALS = new Set(["0", "1", "2"]);
const REPORT_SOURCES = ["packages/eval/src/report.ts", "packages/eval/src/trajectory-report.ts"];
/** One spelling of "a number nothing computed"; the `\d\.` lookbehind keeps a leading-dot decimal such as `.88` whole. */
const NUMBER = /(?<!\w)(?<!\d\.)\d+(?:\.\d+)?/g;
/** A template expression is code the surrounding quotes hide, so both scans read it on the code side. */
const QUOTED = /(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, INTERP = /\$\{[\s\S]*?\}/g;
export function reportLiterals(ctx: VerifyContext): string[] {
  return REPORT_SOURCES.filter((p) => existsSync(join(ctx.root, p))).flatMap((path) => {
    const code = read(ctx, path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const quoted = [...code.matchAll(QUOTED)].map((m) => m[0]).join(" ");
    const outside = `${code.replace(QUOTED, " ")} ${quoted.match(INTERP)?.join(" ") ?? ""}`;
    return [...[...quoted.replace(INTERP, "").matchAll(NUMBER)].map((m) => m[0]),
      ...[...outside.matchAll(NUMBER)].map((m) => m[0]).filter((n) => !ALLOWED_LITERALS.has(n))].map((n) => `${path}: ${n}`);
  });
}

type TrajectoryRow = Record<string, unknown> & { condition: string; task: string; repeat: number; model: string; invocation: string;
  promptHash: string; success: boolean; incomparable?: boolean; turns: number; durationMs: number; inputTokens: number;
  cacheCreation: number; cacheRead: number; outputTokens: number; costUsd: number | null; s1: number | null; s2: number | null;
  artifact: Record<string, unknown> | null; toolCalls: unknown[]; recovery: unknown[] };
const TASKS = ["known-component", "unknown-component", "variant-only", "recovery"];
/** Adoption compares the three; a record may also carry the concluded `cli-agent-compact` of docs/reference/spec.md 4.14. */
const CONDITIONS = ["cli-canonical", "cli-agent", "mcp-agent"], RECORD_CONDITIONS = [...CONDITIONS, "cli-agent-compact"], REPEATS = 2;
/** The one committed trajectory report; T806 redirects `eval trajectory` stdout to this path. */
const REPORT_PATH = "reports/trajectory.md";
/** The one adoption claim the scoring gate verifies; the suffix names the partition whose own records must carry the claim. */
const CLAIM = /^adopted: (cli-agent|mcp-agent) @([0-9a-f]{12})$/;
const unevaluated = (reason: string) => ({ errors: [reason], trajectoryCriteria: "not evaluated" });
const median = (values: number[]): number | null => [...values].sort((a, b) => a - b)[Math.ceil(values.length / 2) - 1] ?? null;
const shown = (value: number | null, digits?: number): string => value === null ? "n/a" : digits === undefined
  ? String(Math.round(value)) : value.toFixed(digits);
const key = (r: TrajectoryRow): string => `${r.promptHash}\0${r.model}\0${r.invocation}`;
const sumCost = (rs: TrajectoryRow[]): number | null => rs.some((r) => r.costUsd === null) ? null
  : rs.reduce((n, r) => n + (r.costUsd ?? 0), 0);
const validRow = (r: TrajectoryRow): boolean => r.adapter === "claude" && TASKS.includes(r.task) && RECORD_CONDITIONS.includes(r.condition)
  && Number.isInteger(r.repeat) && r.repeat >= 0 && [r.model, r.invocation, r.promptHash].every((v) => typeof v === "string")
  && typeof r.success === "boolean" && [r.turns, r.durationMs, r.inputTokens, r.cacheCreation, r.cacheRead, r.outputTokens]
    .every((v) => Number.isFinite(v) && v >= 0) && (r.costUsd === null || Number.isFinite(r.costUsd) && r.costUsd >= 0)
  && [r.s1, r.s2].every((v) => v === null || Number.isFinite(v) && v >= 0 && v <= 1) && [r.toolCalls, r.recovery].every(Array.isArray);
const scoreProvenance = (ctx: VerifyContext, row: TrajectoryRow, lock: string): boolean => {
  const artifact = row.artifact, sample = String(artifact?.sampleName), verifiable = row.incomparable !== true && row.s1 !== null
    && row.s2 !== null && /^[0-9a-f]{40}$/.test(lock) && artifact?.referenceLockCommit === lock && /^[\w-]+$/.test(sample);
  const locked = verifiable ? git(ctx, ["show", `${lock}:samples/${sample}/reference/css/tokens.css`]) : "";
  return locked !== "" && artifact?.tokensCssSha256 === createHash("sha256").update(locked, "utf8").digest("hex"); };

/** The required set is bounded by the partition being judged, so an approved matrix cannot block it. */
export function trajectoryEvidence(ctx: VerifyContext): { errors: string[]; trajectoryCriteria: unknown } {
  const records: unknown[] = [];
  for (const file of matchFiles(ctx, ["runs/*.jsonl"])) for (const [i, line] of read(ctx, file).split("\n").entries()) {
    if (line.trim() === "") continue;
    try { records.push(JSON.parse(line) as unknown); } catch { return unevaluated(`unparsable run record: ${file}:${i + 1}`); } }
  const rows = (records as TrajectoryRow[]).filter((r) => r.cmd === "trajectory" && r.adapter !== "fake");
  if (rows.length === 0) return ctx.files.includes(REPORT_PATH) ? unevaluated("report without run records")
    : { errors: [], trajectoryCriteria: "trajectory criteria: not evaluated (no records)" };
  if (!rows.every(validRow)) return unevaluated("invalid trajectory run record");
  if (!ctx.files.includes(REPORT_PATH)) return unevaluated(`report missing: ${REPORT_PATH}`);
  const lines = read(ctx, REPORT_PATH).split("\n"), lock = git(ctx, ["log", "-1", "--format=%H", "--", "samples/manifest.json"]).trim();
  const byKey = new Map(rows.map((r) => [key(r), { promptHash: r.promptHash, model: r.model, invocation: r.invocation }]));
  const partitions = [...byKey.values()], groups = [...byKey.keys()].map((k) => rows.filter((r) => key(r) === k));
  const summarize = (group: TrajectoryRow[], condition: string) => {
    const all = group.filter((r) => r.condition === condition), good = all.filter((r) => r.incomparable !== true);
    const at = (get: (r: TrajectoryRow) => number | null) => median(good.map(get).filter((v): v is number => v !== null));
    return { condition, runs: good.length, incomparable: all.length - good.length,
      success: good.length === 0 ? null : good.filter((r) => r.success).length / good.length,
      input: at((r) => r.inputTokens + r.cacheCreation + r.cacheRead), output: at((r) => r.outputTokens),
      duration: at((r) => r.durationMs), turns: at((r) => r.turns), calls: good.flatMap((r) => r.toolCalls).length,
      recoveries: good.flatMap((r) => r.recovery).length, cost: at((r) => r.costUsd), s1: at((r) => r.s1), s2: at((r) => r.s2) }; };
  const summaries = groups.map((group) => [...new Set(group.map((r) => r.condition))].map((c) => summarize(group, c)));
  const isRequired = (r: TrajectoryRow): boolean => CONDITIONS.includes(r.condition) && r.repeat < REPEATS, total = sumCost(rows);
  const excludedCost = sumCost(rows.filter((r) => !isRequired(r))), requiredCost = groups.map((g) => sumCost(g.filter(isRequired)));
  const expected = [`Total real cost: ${shown(total, 2)}`,
    ...partitions.flatMap((p, i) => [`## prompt ${p.promptHash} / model ${p.model} / invocation ${p.invocation}`,
      ...(summaries[i] ?? []).map((s) => `| ${[s.condition, s.runs, s.incomparable, shown(s.success, 2), shown(s.input), shown(s.output),
        shown(s.duration), shown(s.turns), s.calls, s.recoveries, shown(s.cost, 2), shown(s.s1, 2), shown(s.s2, 2)].join(" | ")} |`)])];
  const actual = lines.filter((line) => /^Total real cost:|^## prompt |^\| (?:cli|mcp)-/.test(line));
  const disagreeing = lines.find((line) => line.match(NUMBER) !== null && !actual.includes(line) && !CLAIM.test(line))
    ?? actual.find((line, i) => line !== expected[i]) ?? expected[actual.length];
  const errors = disagreeing === undefined ? [] : [`trajectory report measurements disagree: ${disagreeing}`];
  const complete = (rs: TrajectoryRow[]): boolean => rs.length === TASKS.length * REPEATS
    && new Set(rs.map((r) => r.task)).size === TASKS.length && new Set(rs.map((r) => `${r.task}/${r.repeat}`)).size === rs.length
    && rs.every((r) => scoreProvenance(ctx, r, lock));
  const completeSets = groups.map((g) => CONDITIONS.every((c) => complete(g.filter((r) => r.condition === c))));
  const criteria = groups.map((group, i) => Object.fromEntries(CONDITIONS.slice(1).map((condition) => {
    const base = summarize(group, CONDITIONS[0] as string), candidate = summarize(group, condition);
    const adopted = completeSets[i] === true && (requiredCost[i] ?? Infinity) <= 5
      && (candidate.success as number) >= (base.success as number) && (candidate.input as number) <= (base.input as number) * .85
      && (candidate.turns as number) <= (base.turns as number) && (candidate.s1 as number) >= (base.s1 as number)
      && (candidate.s2 as number) >= (base.s2 as number) - .02;
    return [condition, { complete: completeSets[i] === true, adopted, partition: partitions[i] }];
  })));
  const attributed = (line: string): boolean => {
    const m = line.match(CLAIM), at = m === null ? [] : criteria.filter((_, i) => partitions[i]?.promptHash.startsWith(m[2] as string));
    return m !== null && at.length > 0 && at.every((e) => (e[m[1] as string] as { adopted: boolean } | undefined)?.adopted === true); };
  const bad = lines.find((line) => /adopted/i.test(line) && CONDITIONS.some((c) => line.toLowerCase().includes(c)) && !attributed(line));
  if (bad !== undefined) errors.push(`trajectory adoption criteria do not hold: ${bad}`);
  return { errors, trajectoryCriteria: { cost: { total, required: requiredCost, excluded: excludedCost }, conditions: criteria } };
}

export async function scoring(ctx: VerifyContext): Promise<GateResultT> {
  const adversarial = matchFiles(ctx, ["**/*.adversarial.test.ts"]);
  if (adversarial.length === 0) return fail("no *.adversarial.test.ts found", { cases: 0 });
  const run = vitestFor(ctx, "adversarial.test");
  const cases = run.titles.filter((t) => /^A\d\d /.test(t)).length;
  const literals = reportLiterals(ctx), evidence = trajectoryEvidence(ctx);
  const detail = { cases, literals, ...evidence, failed: run.failed };
  if (cases < 12) return fail(`adversarial cases ${cases} < 12`, detail);
  if (run.failed > 0) return fail("adversarial test failed", detail);
  if (literals.length > 0) return fail(`hand-written number in report code: ${literals[0] as string}`, detail);
  if (evidence.errors.length > 0) return fail(evidence.errors[0] as string, detail);
  return ok(detail);
}
