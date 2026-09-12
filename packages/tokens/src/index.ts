import type { SnapshotT, WarningT } from "@tokenloom/schema";
import { stableJsonFile } from "@tokenloom/schema";
import { buildDtcg, modeWarnings } from "./dtcg";
import { emitCss } from "./css";
import { emitSwift } from "./swift";
import { emitKotlin } from "./kotlin";

export * from "./dtcg";
export * from "./css";
export * from "./identifier";
export * from "./native";
export * from "./swift";
export * from "./kotlin";

export type Platform = "css" | "swift" | "kotlin";

export interface TokenBuildResult {
  /** Output-directory-relative path to file contents. */
  files: Record<string, string>;
  tokens: number;
  warnings: WarningT[];
  fatal?: "ALIAS_CYCLE";
}

/**
 * Converts a Snapshot through DTCG (`tokens/*.json`) into platform outputs.
 * Returns fatal errors in `fatal` and recoverable issues in `warnings` instead of throwing.
 */
export function buildTokens(snapshot: SnapshotT, platforms: Platform[]): TokenBuildResult {
  const dtcg = buildDtcg(snapshot);
  if (dtcg.fatal !== undefined) {
    return { files: {}, tokens: 0, warnings: dtcg.warnings, fatal: dtcg.fatal };
  }
  const files: Record<string, string> = {};
  for (const name of [...dtcg.files.keys()].sort()) {
    const tree = dtcg.files.get(name);
    if (tree === undefined) continue;
    files[`tokens/${name}`] = stableJsonFile(tree);
  }
  const chosen = [...new Set(platforms)].sort();
  for (const platform of chosen) {
    if (platform === "css") files["css/tokens.css"] = emitCss(dtcg);
    if (platform === "swift") files["swift/Tokens.swift"] = emitSwift(dtcg);
    if (platform === "kotlin") files["kotlin/Tokens.kt"] = emitKotlin(dtcg);
  }
  // CSS emits every mode as a block, so only native platforms can collapse unsupported branches.
  const native = chosen.some((p) => p === "swift" || p === "kotlin");
  const warnings = [...dtcg.warnings, ...(native ? modeWarnings(dtcg.modes) : [])];
  return { files, tokens: dtcg.tokenCount, warnings: sortWarnings(warnings) };
}

/** Sort warnings by stable identity so input order cannot change serialized output. */
export function sortWarnings(warnings: WarningT[]): WarningT[] {
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return [...warnings].sort((a, b) => cmp(a.code, b.code) || cmp(a.nodeId, b.nodeId));
}
