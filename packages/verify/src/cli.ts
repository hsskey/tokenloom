// `pnpm verify [--gate <name|host>[,<name>...] | --selftest | --shard-fragment | --aggregate <dir> --shards <n>]`
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform, version } from "node:process";
import type { GateIdT, GateResultT, ShardCheckT, VerifyReportT } from "@tokenloom/schema";
import { HOST_GATES, stableJsonFile } from "@tokenloom/schema";
import { git, makeVerifyContext, type VerifyContext } from "./verify-context";
import { GATES, runAll, runGates } from "./index";
import { produceShardFragment, readRunProvenance, requireShardSelector } from "./shard";
import { aggregateShards, collectAggregateInput, parseShardCount } from "./shard-aggregate";

const ROOT = resolve(import.meta.dirname, "../../..");

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? undefined : eq.slice(name.length + 3);
}

function summarize(results: Record<string, GateResultT>): string {
  return Object.entries(results)
    .map(([id, r]) => {
      const mark = r.pass === true ? "PASS" : r.pass === null ? "skip" : "FAIL";
      return `${mark} ${id}${r.pass === false ? `  ${String(r.reason ?? "")}` : ""}`;
    })
    .join("\n");
}

function stamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

/** `host` names every gate except the self-test, so a workflow never spells out the gate list. */
function selectGates(gateArg: string): GateIdT[] {
  const ids = gateArg.split(",").map((g) => g.trim()).flatMap((g) => (g === "host" ? HOST_GATES : [g as GateIdT]));
  const unknown = ids.filter((id) => GATES[id] === undefined);
  if (unknown.length > 0) throw new Error(`unknown gate ${unknown.join(",")}`);
  return ids;
}

function summarizeChecks(checks: ShardCheckT[]): string {
  return checks.map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.name}${c.pass ? "" : `  ${c.detail}`}`).join("\n");
}

async function writeShardFragment(ctx: VerifyContext): Promise<number> {
  const selector = requireShardSelector(process.env.TOKENLOOM_SELFTEST_SHARD);
  const fragment = await produceShardFragment(ctx, selector, readRunProvenance(ctx, process.env));
  const failed = fragment.samples.filter((s) => !s.asExpected);
  const baseline = fragment.baselinePass ? "clean copy passes" : "clean copy fails";
  process.stderr.write(`shard ${selector.index}/${selector.count}: ${baseline}, ${fragment.samples.length - failed.length}`
    + `/${fragment.samples.length} samples as expected\n`);
  process.stdout.write(stableJsonFile(fragment));
  return fragment.baselinePass && failed.length === 0 ? 0 : 1;
}

function writeShardAggregate(ctx: VerifyContext, dir: string | undefined, shardsArg: string | undefined): number {
  if (dir === undefined) throw new Error("--aggregate requires an artifact directory");
  const shardCount = parseShardCount(shardsArg);
  const aggregate = aggregateShards(collectAggregateInput(ctx, resolve(dir), shardCount, process.env));
  process.stderr.write(`${summarizeChecks(aggregate.checks)}\nshard aggregate: ${aggregate.green ? "green" : "red"} (non-authoritative)\n`);
  process.stdout.write(stableJsonFile(aggregate));
  return aggregate.green ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  const started = Date.now();
  const ctx = makeVerifyContext(ROOT);

  const gateArg = arg(argv, "gate");
  if (gateArg !== undefined) {
    const ids = selectGates(gateArg);
    const results = await runGates(ctx, ids);
    process.stderr.write(`${summarize(results)}\n`);
    process.stdout.write(stableJsonFile(results));
    return Object.values(results).some((r) => r.pass === false) ? 1 : 0;
  }

  if (argv.includes("--selftest")) {
    const results = await runGates(ctx, ["selftest"]);
    process.stderr.write(`${summarize(results)}\n`);
    process.stdout.write(stableJsonFile(results.selftest ?? { pass: null }));
    return results.selftest?.pass === true ? 0 : 1;
  }

  if (argv.includes("--shard-fragment")) return writeShardFragment(ctx);
  // A flag without its directory must fail rather than fall through to a complete run.
  const aggregateDir = arg(argv, "aggregate");
  if (aggregateDir !== undefined || argv.includes("--aggregate")) return writeShardAggregate(ctx, aggregateDir, arg(argv, "shards"));

  const results = await runAll(ctx);
  const durationSec = Math.round((Date.now() - started) / 1000);
  const report: VerifyReportT = {
    commit: git(ctx, ["rev-parse", "--short", "HEAD"]).trim(),
    utc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    node: version,
    os: platform,
    durationSec,
    gates: results,
  };
  const outDir = join(ROOT, "verify");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `verify-${stamp()}.json`);
  writeFileSync(outPath, stableJsonFile(report));
  process.stderr.write(`${summarize(results)}\nverify: ${outPath} (${durationSec}s)\n`);
  const failed = Object.values(results).filter((r) => r.pass === false).length;
  const limit = ctx.config.maxRuntimeSec;
  // Wall-clock runtime is environment-dependent and is judged only when this host has a baseline.
  const partial = results.benchmarks?.mode === "partial_environment";
  const over = durationSec > limit;
  if (over) process.stderr.write(`verify: over time budget ${durationSec}s > ${limit}s${partial ? " (recorded, not judged)" : ""}\n`);
  return failed === 0 && (!over || partial) ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`verify: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
