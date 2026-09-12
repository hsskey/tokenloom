// `pnpm bench [--json]`; appends one record per benchmark to bench/results.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { stableStringify } from "@tokenloom/schema";
import type { BenchRecord } from "./util";
import { realRecords, run as context } from "./context.bench";
import { run as agent } from "./agent.bench";
import { run as variant } from "./variant.bench";
import { run as deltaPath } from "./delta-path.bench";
import { run as discovery } from "./discovery.bench";
import { run as tokens } from "./tokens.bench";
import { run as scale } from "./scale.bench";
import { run as cache } from "./cache.bench";
import { run as mcp } from "./mcp.bench";

const ROOT = resolve(import.meta.dirname, "..");

const records: BenchRecord[] = [
  context(), agent(), variant(), deltaPath(), discovery(), ...realRecords(), tokens(), scale(), cache(), mcp(),
];

mkdirSync(join(ROOT, "bench"), { recursive: true });
const utc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
for (const record of records) {
  appendFileSync(join(ROOT, "bench/results.jsonl"), stableStringify({ ...record, utc }, 0) + "\n");
}
if (process.argv.includes("--json")) process.stdout.write(stableStringify(records) + "\n");
process.stderr.write(`bench: ${records.length} records appended\n`);
