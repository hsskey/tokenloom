// Renders the SPEC 9.6 report from an already-computed model. Arithmetic and numeric literals stay
// in stats.ts so the scoring gate can prove every number came from run records.
import type { ReportModel } from "./stats";

const HEADER = "# tokenloom eval";
const SEC_WORKS = "## What works";
const SEC_FAILS = "## What does not work";
const SEC_COST = "## Fixed cost by input source";
const SEC_SAMPLE = "## Sample size and limitations";
/** Explains below each table which rows the column excludes. */
export const WORKS_NOTE = "`Input tokens p50 (cache-write rows)` counts only the first cache write of a prompt."
  + " Repeated rows reuse the prompt through cache reads and are excluded.";

const S2_THRESHOLD = 0.95;

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

export function passesS2(value: number): boolean {
  return value >= S2_THRESHOLD;
}

function table(headers: string[], rows: string[][]): string {
  const divider = headers.map(() => "---");
  return [row(headers), row(divider), ...rows.map(row)].join("\n");
}

/** Emits the four SPEC 9.6 sections in their required order. */
export function renderReport(model: ReportModel): string {
  const title = `${HEADER} ${model.date} / model ${model.model} / prompt ${model.promptHash}`
    + ` / mcp captures ${model.mcpCaptures}`;

  const works = table(
    ["Sample class", "Input", "Input variant", "S1", "S2", "S3", "Input tokens p50 (cache-write rows)", "Cost p50", "Latency p50"],
    model.rows.map((r) =>
      [r.class, r.input, r.inputVariant, r.s1, r.s2, r.s3, r.inputTokensP50, r.costP50, r.latencyP50]),
  );

  const fails = table(
    ["Target", "Failure", "Retry condition"],
    model.failures.map((f) => [f.item, f.mode, f.retryWhen]),
  );

  const costs = table(
    ["Input", "Session schema tokens", "Tokens per component p50"],
    model.fixedCosts.map((c) => [c.input, c.sessionSchemaTokens, c.tokensPerComponentP50]),
  );

  const notes = model.sampleNotes.map((line) => `- ${line}`).join("\n");

  return [
    title,
    "",
    "All measurements are aggregated from actual calls in `runs/*.jsonl`; fake runs are excluded.",
    "",
    SEC_WORKS,
    "",
    works,
    "",
    WORKS_NOTE,
    "",
    SEC_FAILS,
    "",
    fails,
    "",
    SEC_COST,
    "",
    costs,
    "",
    SEC_SAMPLE,
    "",
    notes,
    "",
  ].join("\n");
}

/** Gives each prompt hash its own headed section instead of combining hashes (SPEC 9.6). */
export function renderReports(models: ReportModel[]): string {
  return models.map(renderReport).join("\n");
}
