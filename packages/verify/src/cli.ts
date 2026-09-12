// `pnpm verify [--gate <name>[,<name>...] | --selftest]`
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform, version } from "node:process";
import type { GateIdT, GateResultT, VerifyReportT } from "@tokenloom/schema";
import { stableJsonFile } from "@tokenloom/schema";
import { git, makeVerifyContext } from "./verify-context";
import { GATES, runAll, runGates } from "./index";

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

export async function main(argv: string[]): Promise<number> {
  const started = Date.now();
  const ctx = makeVerifyContext(ROOT);

  const gateArg = arg(argv, "gate");
  if (gateArg !== undefined) {
    const ids = gateArg.split(",").map((g) => g.trim()) as GateIdT[];
    const unknown = ids.filter((id) => GATES[id] === undefined);
    if (unknown.length > 0) throw new Error(`unknown gate ${unknown.join(",")}`);
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
