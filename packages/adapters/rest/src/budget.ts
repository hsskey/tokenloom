import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { stableJsonFile } from "@tokenloom/schema";
import {
  BudgetAdjustment,
  BudgetLedger,
  budgetFailure,
  freshLedger,
  planWindows,
  prune,
  refusingWindow,
  spend,
  windowUse,
  type Budget,
  type BudgetAdjustmentT,
  type BudgetConfig,
  type BudgetLedgerT,
} from "./budget-policy";

export const BUDGET_PATH = join(".tokenloom", "budget.json");

const LegacyLedger = z.object({
  month: z.string(),
  tier1: z.object({ used: z.number(), cap: z.number() }),
  mcp: z.object({ used: z.number(), cap: z.number() }),
  adjustments: z.array(BudgetAdjustment).default([]),
});

export function applyAdjustment(
  root: string,
  ledger: BudgetLedgerT,
  adjustment: BudgetAdjustmentT,
): { ok: true; ledger: BudgetLedgerT } | { ok: false; reason: string } {
  if (!existsSync(join(root, adjustment.evidence))) {
    return { ok: false, reason: `missing evidence at ${adjustment.evidence}` };
  }
  return { ok: true, ledger: { ...ledger, adjustments: [...ledger.adjustments, adjustment] } };
}

export type LedgerRead = { ok: true; ledger: BudgetLedgerT } | { ok: false; reason: string };

export function readLedger(root: string): LedgerRead {
  let text: string;
  try {
    text = readFileSync(join(root, BUDGET_PATH), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { ok: true, ledger: freshLedger() };
    return { ok: false, reason: `unreadable ledger at ${BUDGET_PATH}` };
  }
  const raw = parseJson(text);
  const parsed = BudgetLedger.safeParse(raw);
  if (parsed.success) return { ok: true, ledger: parsed.data };
  if (LegacyLedger.safeParse(raw).success) {
    return { ok: false, reason: `legacy month-format ledger at ${BUDGET_PATH}; delete it and run again` };
  }
  return { ok: false, reason: `corrupt ledger at ${BUDGET_PATH}` };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeLedger(root: string, ledger: BudgetLedgerT): void {
  const file = join(root, BUDGET_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stableJsonFile(ledger), "utf8");
}

export function createFileBudget(
  root: string,
  plan: string,
  config: BudgetConfig,
  now: () => number,
): { ok: true; budget: Budget } | { ok: false; reason: string } {
  const windows = planWindows(plan, config);
  if (windows === null) {
    return { ok: false, reason: `no budget window for plan "${plan}" (docs/reference/spec.md section 0)` };
  }
  const read = readLedger(root);
  if (!read.ok) return read;
  let ledger = read.ledger;
  return {
    ok: true,
    budget: {
      spend(scope, count) {
        const nowMs = now();
        const refused = refusingWindow(ledger, scope, count, windows[scope], nowMs);
        if (refused !== null) return budgetFailure(ledger, scope, count, refused, nowMs);
        ledger = prune(spend(ledger, scope, count, nowMs), windows, nowMs);
        writeLedger(root, ledger);
        return null;
      },
      current: () => windowUse(ledger, windows, now()),
    },
  };
}
