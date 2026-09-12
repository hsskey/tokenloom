import type { WarningCodeT, WarningT } from "@tokenloom/schema";
import { stableJsonFile } from "@tokenloom/schema";
import { buildTokens } from "@tokenloom/tokens";
import { buildDesignContext } from "@tokenloom/parser";
import { EXIT, exitFor, flagBool, flagString, usageError, type Parsed } from "./args";
import { loadSnapshots } from "./load";
import { appendRun } from "./runs";
import config from "../../../tokenloom.config";

const PAT_WARN_DAYS = 80;
const MS_PER_DAY = 86_400_000;

/** Evaluate PAT expiry against the docs/reference/spec.md section 8 warning boundary using the CLI's clock. */
export function patAgeDays(createdAt: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(createdAt)) / MS_PER_DAY);
}

export function countByCode(warnings: WarningT[]): Record<string, number> {
  const table: Record<string, number> = {};
  for (const w of warnings) table[w.code] = (table[w.code] ?? 0) + 1;
  return table;
}

export function cmdDoctor(parsed: Parsed, collect: (from: string) => WarningT[]): number {
  const from = flagString(parsed, "from");
  if (from === undefined) return usageError("doctor: --from <snapshot.json> is required");
  const started = performance.now();
  const warnings = collect(from);
  const byCode = countByCode(warnings);
  // Date-dependent expiry warnings belong on stderr to preserve deterministic JSON output.
  const patDays = patAgeDays(config.patCreatedAt, Date.now());
  for (const code of Object.keys(byCode).sort()) process.stderr.write(`${code}\t${byCode[code] as number}\n`);
  if (patDays >= PAT_WARN_DAYS) process.stderr.write(`PAT_EXPIRY_SOON ${patDays} days since ${config.patCreatedAt}\n`);
  // A healthy snapshot produces an empty table, so the total also reports that the check ran.
  process.stderr.write(`doctor: ${warnings.length} warnings\n`);
  if (flagBool(parsed, "json")) {
    process.stdout.write(stableJsonFile({ byCode, warnings, total: warnings.length }));
  }
  const ms = { doctor: Math.round(performance.now() - started) };
  appendRun({ cmd: "doctor", target: from, bytesIn: 0, bytesOut: 0, ms, warnings: warnings.length });
  return exitFor(warnings.length, flagBool(parsed, "strict"));
}

/** Combine token warnings with design-context warnings for every component set. */
export function collectAllWarnings(from: string): WarningT[] {
  const { snapshot } = loadSnapshots(from);
  const warnings = [...buildTokens(snapshot, ["css"]).warnings];
  for (const set of snapshot.componentSets) {
    const result = buildDesignContext(snapshot, { name: set.name, nodeId: set.id });
    if (result.ok) warnings.push(...result.warnings);
  }
  return warnings;
}

export const DOCTOR_EXIT_FATAL: number = EXIT.fatal;
export type DoctorCode = WarningCodeT;
