import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stableJsonFile } from "@tokenloom/schema";
import type { Platform } from "@tokenloom/tokens";
import { buildTokens } from "@tokenloom/tokens";
import { EXIT, exitFor, flagBool, flagString, usageError, type Parsed } from "./args";
import { loadSnapshots } from "./load";
import { appendRun } from "./runs";

const PLATFORMS = new Set(["css", "swift", "kotlin"]);

export function cmdTokensBuild(parsed: Parsed): number {
  const from = flagString(parsed, "from");
  if (from === undefined) return usageError("tokens build: --from <snapshot.json> is required");
  const out = flagString(parsed, "out") ?? "dist/tokens";
  const platforms = (flagString(parsed, "platform") ?? "css").split(",").map((p) => p.trim());
  const unknown = platforms.filter((p) => !PLATFORMS.has(p));
  if (unknown.length > 0) return usageError(`tokens build: unknown platform ${unknown.join(",")}`);

  const startedLoad = performance.now();
  const { snapshot, bytesIn } = loadSnapshots(from);
  const loadMs = Math.round(performance.now() - startedLoad);

  const startedBuild = performance.now();
  const result = buildTokens(snapshot, platforms as Platform[]);
  const buildMs = Math.round(performance.now() - startedBuild);
  const ms = { load: loadMs, build: buildMs };

  if (result.fatal !== undefined) {
    for (const w of result.warnings) process.stderr.write(`${w.code} ${w.nodeId} ${w.detail}\n`);
    process.stderr.write(`tokens build: ${result.fatal}\n`);
    // Emit JSON warnings even on fatal errors so M09 can verify the warning-code set.
    if (flagBool(parsed, "json")) {
      process.stdout.write(stableJsonFile({ files: [], tokens: 0, warnings: result.warnings }));
    }
    appendRun({ cmd: "tokens build", target: from, bytesIn, bytesOut: 0, ms, warnings: result.warnings.length });
    return EXIT.fatal;
  }

  const written: string[] = [];
  let bytesOut = 0;
  for (const rel of Object.keys(result.files).sort()) {
    const content = result.files[rel] as string;
    const path = join(out, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push(path);
    bytesOut += Buffer.byteLength(content, "utf8");
  }

  for (const w of result.warnings) process.stderr.write(`${w.code} ${w.nodeId} ${w.detail}\n`);
  process.stderr.write(`tokens build: ${written.length} files, ${result.tokens} tokens, ${result.warnings.length} warnings\n`);
  if (flagBool(parsed, "json")) {
    process.stdout.write(stableJsonFile({ files: written, tokens: result.tokens, warnings: result.warnings }));
  }
  appendRun({ cmd: "tokens build", target: from, bytesIn, bytesOut, ms, warnings: result.warnings.length });
  return exitFor(result.warnings.length, flagBool(parsed, "strict"));
}
