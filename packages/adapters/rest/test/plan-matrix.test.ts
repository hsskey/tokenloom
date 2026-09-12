// The budget.ts plan table is a runtime copy of the canonical plan matrix and must match it exactly.
// Reserve values are absent from the matrix and remain governed by the corresponding decision record.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAN_BUDGETS, type PlanId, type WindowPer } from "../src/index";

/** Matrix rows selected by the prefix in their first cell. */
const ROWS: { scope: "tier1" | "mcp"; startsWith: string }[] = [
  { scope: "tier1", startsWith: "| REST Tier 1:" },
  { scope: "mcp", startsWith: "| MCP remote server at" },
];

/** Matrix column order after the first feature-name cell. */
const PLAN_COLUMNS: PlanId[] = ["starter", "pro", "enterprise"];

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (readdirSafe(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("pnpm-workspace.yaml not found");
}

function readdirSafe(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Parse the window and cap forms used by one matrix cell. */
export function parseCell(cell: string): { per: WindowPer; cap: number }[] {
  const out: { per: WindowPer; cap: number }[] = [];
  const day = /(\d+)\s+calls?\s+per\s+day/i.exec(cell);
  if (day !== null) out.push({ per: "day", cap: Number(day[1]) });
  const month = /(\d+)\s+(?:tool\s+)?calls?\s+per\s+month/i.exec(cell);
  if (month !== null) out.push({ per: "month", cap: Number(month[1]) });
  const minute = /(\d+)\s+(?:calls?\s+)?per\s+minute/i.exec(cell);
  if (minute !== null) out.push({ per: "minute", cap: Number(minute[1]) });
  return out;
}

/** Window caps by plan and scope from the canonical matrix. */
function matrixCaps(): Record<PlanId, Record<"tier1" | "mcp", { per: WindowPer; cap: number }[]>> {
  const spec = readFileSync(join(repoRoot(), "docs/reference/spec.md"), "utf8").split("\n");
  const out = {} as Record<PlanId, Record<"tier1" | "mcp", { per: WindowPer; cap: number }[]>>;
  for (const plan of PLAN_COLUMNS) out[plan] = { tier1: [], mcp: [] };
  for (const { scope, startsWith } of ROWS) {
    const line = spec.find((l) => l.startsWith(startsWith));
    if (line === undefined) throw new Error(`canonical plan matrix has no ${startsWith} row`);
    const cells = line.split("|").slice(2, 5).map((c) => c.trim());
    PLAN_COLUMNS.forEach((plan, i) => {
      out[plan][scope] = parseCell(cells[i] ?? "");
    });
  }
  return out;
}

describe("plan table and canonical matrix (docs/reference/spec.md sections 0 and 4.10)", () => {
  it("parses window types and caps from matrix cells", () => {
    expect(parseCell("20 tool calls per month")).toEqual([{ per: "month", cap: 20 }]);
    expect(parseCell("10 calls per minute")).toEqual([{ per: "minute", cap: 10 }]);
    expect(parseCell("200 calls per day and 10 per minute")).toEqual([
      { per: "day", cap: 200 },
      { per: "minute", cap: 10 },
    ]);
  });

  it.each(PLAN_COLUMNS)("matches %s window caps to the matrix cell", (plan) => {
    const expected = matrixCaps()[plan];
    const actual = {
      tier1: PLAN_BUDGETS[plan].tier1.map((w) => ({ per: w.per, cap: w.cap })),
      mcp: PLAN_BUDGETS[plan].mcp.map((w) => ({ per: w.per, cap: w.cap })),
    };
    expect(actual).toEqual(expected);
  });

  it("omits plans that have no matrix column", () => {
    expect(Object.keys(PLAN_BUDGETS)).toEqual(PLAN_COLUMNS);
  });
});
