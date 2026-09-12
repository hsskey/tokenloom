// Reference-output comparison, determinism, and mutation contracts all spawn the built CLI.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateResultT } from "@tokenloom/schema";
import { stableJsonFile, variantSelectorOf } from "@tokenloom/schema";
import { fail, has, ok, read, sh, type VerifyContext } from "../verify-context";

const CLI = "apps/cli/dist/tokenloom.js";
/** Platforms compared against reference output; comparison skips samples without Swift or Kotlin references. */
const PLATFORMS = "css,swift,kotlin";

export interface SnapshotSample {
  name: string;
  snapshot: string;
  referenceDir: string;
  component: string;
  variant: string;
}

export function snapshotSamples(ctx: VerifyContext): SnapshotSample[] {
  const base = join(ctx.root, "samples");
  if (!existsSync(base)) return [];
  const out: SnapshotSample[] = [];
  for (const name of readdirSync(base).sort()) {
    const snapshot = `samples/${name}/snapshot.json`;
    if (!has(ctx, snapshot) || !has(ctx, `samples/${name}/reference`)) continue;
    const parsed = JSON.parse(read(ctx, snapshot)) as {
      componentSets: { name: string; components: { props: Record<string, string> }[] }[];
    };
    const set = parsed.componentSets[0];
    const props = set?.components[0]?.props ?? {};
    out.push({
      name,
      snapshot,
      referenceDir: `samples/${name}/reference`,
      component: set?.name ?? "",
      variant: variantSelectorOf(props),
    });
  }
  return out;
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(ctx: VerifyContext, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = sh(ctx, "node", [join(ctx.root, CLI), ...args]);
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function diffFile(ctx: VerifyContext, actualPath: string, referenceRel: string): string | null {
  if (!existsSync(actualPath)) return `${referenceRel}: output missing`;
  const actual = readFileSync(actualPath, "utf8");
  const reference = read(ctx, referenceRel);
  if (actual === reference) return null;
  // A same-length change makes a length delta read as zero, so name the first differing character.
  let at = 0;
  while (at < actual.length && at < reference.length && actual[at] === reference[at]) at += 1;
  const size = (text: string): number => Buffer.byteLength(text, "utf8");
  return `${referenceRel}: differs at char ${at} (${size(actual)} vs ${size(reference)} bytes)`;
}

export async function reference(ctx: VerifyContext): Promise<GateResultT> {
  const diffs: string[] = [];
  const list = snapshotSamples(ctx);
  for (const fx of list) {
    const out = tmp("tl-reference-");
    runCli(ctx, ["tokens", "build", "--from", join(ctx.root, fx.snapshot), "--platform", PLATFORMS, "--out", out]);
    if (has(ctx, `${fx.referenceDir}/css/tokens.css`)) {
      const d = diffFile(ctx, join(out, "css/tokens.css"), `${fx.referenceDir}/css/tokens.css`);
      if (d !== null) diffs.push(d);
    }
    // Swift and Kotlin reference output joins the comparison scope alongside CSS.
    for (const [dir, name] of [["swift", "Tokens.swift"], ["kotlin", "Tokens.kt"]] as const) {
      if (!has(ctx, `${fx.referenceDir}/${dir}/${name}`)) continue;
      const d = diffFile(ctx, join(out, dir, name), `${fx.referenceDir}/${dir}/${name}`);
      if (d !== null) diffs.push(d);
    }
    if (has(ctx, `${fx.referenceDir}/tokens`)) {
      for (const name of readdirSync(join(ctx.root, fx.referenceDir, "tokens")).sort()) {
        const d = diffFile(ctx, join(out, "tokens", name), `${fx.referenceDir}/tokens/${name}`);
        if (d !== null) diffs.push(d);
      }
    }
    if (!has(ctx, `${fx.referenceDir}/context.compact.json`)) continue;
    const res = runCli(ctx, ["context", fx.component, "--from", join(ctx.root, fx.snapshot), "--annotations", "--json"]);
    const contextPath = join(out, "context.compact.json");
    writeFileSync(contextPath, res.stdout);
    const d = diffFile(ctx, contextPath, `${fx.referenceDir}/context.compact.json`);
    if (d !== null) diffs.push(d);
    if (has(ctx, `${fx.referenceDir}/warnings.json`)) {
      const parsed = JSON.parse(res.stdout === "" ? "{}" : res.stdout) as { warnings?: unknown[] };
      const warnPath = join(out, "warnings.json");
      writeFileSync(warnPath, stableJsonFile(parsed.warnings ?? []));
      const w = diffFile(ctx, warnPath, `${fx.referenceDir}/warnings.json`);
      if (w !== null) diffs.push(w);
    }
    if (fx.name !== "button") continue;
    const agentReference = `${fx.referenceDir}/context.agent.json`;
    if (!has(ctx, agentReference)) { diffs.push(`${agentReference}: reference missing`); continue; }
    const agent = runCli(ctx, [
      "context", fx.component, "--from", join(ctx.root, fx.snapshot), "--annotations", "--json", "--view", "agent",
    ]);
    if (agent.status !== 0) { diffs.push(`${agentReference}: CLI exit ${agent.status}`); continue; }
    const agentPath = join(out, "context.agent.json");
    writeFileSync(agentPath, agent.stdout);
    const agentDiff = diffFile(ctx, agentPath, agentReference);
    if (agentDiff !== null) diffs.push(agentDiff);
  }
  const lock = sh(ctx, "node", ["node_modules/tsx/dist/cli.mjs", "scripts/reference-lock.ts", "--check"]);
  const manifestChanged = lock.status !== 0;
  const changes = has(ctx, "samples/CHANGES.md") ? read(ctx, "samples/CHANGES.md") : "";
  const unlogged = Object.keys(JSON.parse(read(ctx, "samples/manifest.json")) as Record<string, string>)
    .filter((p) => !changes.includes(p));
  const detail = { samples: list.length, diffBytes: diffs.length, manifestChanged, diffs, unlogged };
  if (diffs.length > 0) return fail(diffs[0] as string, detail);
  if (manifestChanged) return fail(`manifest mismatch: ${lock.stderr.trim().split("\n")[1] ?? ""}`, detail);
  if (unlogged.length > 0) return fail(`reference without CHANGES.md record: ${unlogged[0] as string}`, detail);
  return ok(detail);
}

/**
 * Reverses object-key order and only order-insensitive arrays. The determinism gate identifies `variables`,
 * `annotations`, and `textStyles`; `components` and `children` retain meaningful variant/layer order.
 */
const ORDER_FREE = new Set(["variables", "annotations", "textStyles"]);

export function shuffle(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => shuffle(v));
    return key !== undefined && ORDER_FREE.has(key) ? items.reverse() : items;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([k, v]) => [k, shuffle(v, k)]));
  }
  return value;
}

export async function determinism(ctx: VerifyContext): Promise<GateResultT> {
  const list = snapshotSamples(ctx);
  const mismatches: string[] = [];
  let runs = 0;
  for (const fx of list) {
    const shuffledPath = join(tmp("tl-determinism-in-"), "snapshot.json");
    const raw = JSON.parse(read(ctx, fx.snapshot)) as Record<string, unknown>;
    const mixed = shuffle(raw) as Record<string, unknown>;
    mixed.version = 1;
    writeFileSync(shuffledPath, stableJsonFile(mixed));
    const commands: string[][] = [
      ["tokens", "build", "--from", "@SNAPSHOT@", "--platform", PLATFORMS, "--out", "@OUT@", "--json"],
    ];
    commands.push(["context", fx.component, "--from", "@SNAPSHOT@", "--annotations", "--json"]);
    commands.push(["context", fx.component, "--from", "@SNAPSHOT@", "--annotations", "--json", "--view", "agent"]);
    commands.push([
      "context", fx.component, "--from", "@SNAPSHOT@", "--annotations", "--json", "--view", "agent",
      `--variant=${fx.variant}`,
    ]);
    commands.push(["context", "--match", fx.component, "--from", "@SNAPSHOT@", "--json", "--view", "agent"]);
    for (const template of commands) {
      const out = tmp("tl-determinism-out-");
      const results = [join(ctx.root, fx.snapshot), join(ctx.root, fx.snapshot), shuffledPath].map((snapshotPath) => {
        const args = template.map((a) => a.replace("@SNAPSHOT@", snapshotPath).replace("@OUT@", out));
        runs += 1;
        return runCli(ctx, args);
      });
      const label = template.filter((part) => part !== "@SNAPSHOT@" && part !== "@OUT@").join(" ");
      const failed = results.find((result) => result.status !== 0);
      if (failed !== undefined) mismatches.push(`${fx.name} ${label}: exit ${failed.status}`);
      else if (new Set(results.map((result) => result.stdout)).size !== 1) {
        mismatches.push(`${fx.name} ${label}: outputs differ`);
      }
    }
  }
  const detail = { runs, identical: mismatches.length === 0, mismatches };
  return mismatches.length === 0 ? ok(detail) : fail(mismatches[0] as string, detail);
}

export interface MutationExpect {
  cmd?: string;
  warnings?: string[];
  exit: number;
  exitStrict?: number;
  stderrIncludes?: string[];
  variantHasRoot?: boolean;
  childrenCount?: number;
  files?: string[];
  jsonError?: string;
  includes?: string[];
  count?: number;
  returned?: number;
  preserves?: string[];
}

function warningCodes(stdout: string): string[] {
  const parsed = JSON.parse(stdout === "" ? "{}" : stdout) as { warnings?: { code: string }[] };
  return [...new Set((parsed.warnings ?? []).map((w) => w.code))].sort();
}

/** Every mutation sample in the specification must be reproduced; see docs/reference/spec.md section 5.5. */
export const MUTATION_IDS = Array.from({ length: 15 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);

function withoutFlag(args: string[], flag: string): string[] {
  const at = args.indexOf(`--${flag}`);
  return at < 0 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
}

export async function mutations(ctx: VerifyContext): Promise<GateResultT> {
  const expectedPath = "samples/mutations/expected.json";
  if (!has(ctx, expectedPath)) return fail(`${expectedPath} is missing`, { mutations: 0, matched: 0 });
  const expected = JSON.parse(read(ctx, expectedPath)) as Record<string, MutationExpect>;
  const ids = MUTATION_IDS;
  const missing = ids.filter((id) => expected[id] === undefined || !has(ctx, `samples/mutations/${id}.json`));
  if (missing.length > 0) return fail(`missing mutation cases: ${missing.join(",")}`, { mutations: ids.length, matched: 0, missing });
  const failures: string[] = [];
  let matched = 0;
  for (const id of ids) {
    const spec = expected[id] as MutationExpect;
    const from = join(ctx.root, `samples/mutations/${id}.json`);
    const base = (spec.cmd ?? "context Button").split(" ");
    const args = [...base, "--from", from, "--json"];
    if (base[0] === "context") args.push("--annotations");
    if (base[0] === "tokens") args.push("--out", tmp("tl-g07-"));
    const res = runCli(ctx, args);
    const problems: string[] = [];
    if (res.status !== spec.exit) problems.push(`exit ${res.status} != ${spec.exit}`);
    if (spec.warnings !== undefined) {
      const actual = warningCodes(res.stdout);
      const want = [...spec.warnings].sort();
      if (actual.join(",") !== want.join(",")) problems.push(`warnings [${actual}] != [${want}]`);
    }
    for (const needle of spec.stderrIncludes ?? []) {
      if (!res.stderr.includes(needle)) problems.push(`stderr missing "${needle}"`);
    }
    if (spec.exitStrict !== undefined) {
      const strict = runCli(ctx, [...args, "--strict"]);
      if (strict.status !== spec.exitStrict) problems.push(`strict exit ${strict.status} != ${spec.exitStrict}`);
    }
    const canonical = spec.preserves === undefined ? undefined : runCli(ctx, withoutFlag(args, "view")).stdout;
    problems.push(...structureChecks(spec, res.stdout), ...agentOutputChecks(spec, res.stdout, canonical));
    if (spec.files !== undefined) {
      const out = tmp("tl-g07-files-");
      runCli(ctx, [...base, "--from", from, "--out", out]);
      const written = existsSync(join(out, "tokens")) ? readdirSync(join(out, "tokens")).sort() : [];
      for (const name of spec.files) if (!written.includes(name)) problems.push(`missing output ${name}`);
    }
    if (problems.length === 0) matched += 1;
    else failures.push(`${id}: ${problems.join("; ")}`);
  }
  const detail = { mutations: ids.length, matched, failures };
  return failures.length === 0 ? ok(detail) : fail(failures[0] as string, detail);
}

function structureChecks(spec: MutationExpect, stdout: string): string[] {
  if (spec.variantHasRoot === undefined && spec.childrenCount === undefined) return [];
  const context = JSON.parse(stdout === "" ? "{}" : stdout) as {
    component?: { base?: { root?: { children?: unknown[] } }; variants?: { root?: unknown }[] };
  };
  const problems: string[] = [];
  if (spec.variantHasRoot !== undefined) {
    const hasRoot = (context.component?.variants ?? []).some((v) => v.root !== undefined);
    if (hasRoot !== spec.variantHasRoot) problems.push(`variantHasRoot ${hasRoot} != ${spec.variantHasRoot}`);
  }
  if (spec.childrenCount !== undefined) {
    const n = context.component?.base?.root?.children?.length ?? -1;
    if (n !== spec.childrenCount) problems.push(`childrenCount ${n} != ${spec.childrenCount}`);
  }
  return problems;
}

function valuesNamed(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => valuesNamed(item, key));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([name, child]) => [
    ...(name === key ? [child] : []),
    ...valuesNamed(child, key),
  ]);
}

export function agentOutputChecks(spec: MutationExpect, stdout: string, canonicalStdout?: string): string[] {
  if (spec.jsonError === undefined && spec.includes === undefined && spec.count === undefined
    && spec.returned === undefined && spec.preserves === undefined) return [];
  let actual: Record<string, unknown>;
  let canonical: Record<string, unknown> = {};
  try {
    actual = JSON.parse(stdout) as Record<string, unknown>;
    if (canonicalStdout !== undefined) canonical = JSON.parse(canonicalStdout) as Record<string, unknown>;
  } catch {
    return ["Agent output is not JSON"];
  }
  const problems: string[] = [];
  const error = actual.error as { code?: string } | undefined;
  if (spec.jsonError !== undefined && error?.code !== spec.jsonError) {
    problems.push(`json error ${String(error?.code)} != ${spec.jsonError}`);
  }
  for (const needle of spec.includes ?? []) {
    if (valuesNamed(actual, needle).length === 0) problems.push(`JSON missing ${needle}`);
  }
  if (spec.count !== undefined && actual.count !== spec.count) problems.push(`count ${String(actual.count)} != ${spec.count}`);
  if (spec.returned !== undefined && actual.returned !== spec.returned) {
    problems.push(`returned ${String(actual.returned)} != ${spec.returned}`);
  }
  for (const field of spec.preserves ?? []) {
    const key = field === "nodeId" ? "id" : field;
    if (JSON.stringify(valuesNamed(actual, key)) !== JSON.stringify(valuesNamed(canonical, key))) {
      problems.push(`${field} was not preserved`);
    }
  }
  return problems;
}
