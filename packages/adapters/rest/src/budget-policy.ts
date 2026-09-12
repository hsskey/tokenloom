import { z } from "zod";
import type { BudgetScope, RestFailure } from "./result";

export const BudgetAdjustment = z.object({
  utc: z.string(),
  kind: z.enum(["tier1", "mcp"]),
  delta: z.number(),
  reason: z.string(),
  evidence: z.string(),
});
export type BudgetAdjustmentT = z.infer<typeof BudgetAdjustment>;

export const BudgetLedger = z.object({
  calls: z.object({ tier1: z.array(z.number()), mcp: z.array(z.number()) }),
  adjustments: z.array(BudgetAdjustment).default([]),
});
export type BudgetLedgerT = z.infer<typeof BudgetLedger>;

export type WindowPer = "minute" | "day" | "month";
export interface BudgetWindow { per: WindowPer; cap: number; reserve: number }
export type PlanWindows = Record<BudgetScope, BudgetWindow[]>;
export type PlanId = "starter" | "pro" | "enterprise";

export const PLAN_BUDGETS: Record<PlanId, PlanWindows> = {
  starter: {
    tier1: [{ per: "month", cap: 20, reserve: 5 }],
    mcp: [{ per: "month", cap: 20, reserve: 5 }],
  },
  pro: {
    tier1: [{ per: "minute", cap: 10, reserve: 2 }],
    mcp: [{ per: "day", cap: 200, reserve: 20 }, { per: "minute", cap: 10, reserve: 1 }],
  },
  enterprise: {
    tier1: [{ per: "minute", cap: 20, reserve: 4 }],
    mcp: [{ per: "day", cap: 600, reserve: 60 }, { per: "minute", cap: 20, reserve: 2 }],
  },
};

export interface BudgetConfig {
  overrides?: Record<string, { cap?: number; reserve?: number }>;
}

export const TIER1_CALL_COST = 1;
export const MCP_CAPTURE_COST = 3;

const SLIDING_MS: Record<"minute" | "day", number> = { minute: 60_000, day: 86_400_000 };

export function monthKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function inWindow(per: WindowPer, ts: number, nowMs: number): boolean {
  if (per === "month") return monthKey(ts) === monthKey(nowMs);
  return nowMs - ts < SLIDING_MS[per];
}

export function planWindows(plan: string, config: BudgetConfig): PlanWindows | null {
  const row = PLAN_BUDGETS[plan as PlanId] as PlanWindows | undefined;
  if (row === undefined) return null;
  const apply = (scope: BudgetScope): BudgetWindow[] =>
    row[scope].map((window) => ({ ...window, ...config.overrides?.[`${scope}.${window.per}`] }));
  return { tier1: apply("tier1"), mcp: apply("mcp") };
}

export function freshLedger(): BudgetLedgerT {
  return { calls: { tier1: [], mcp: [] }, adjustments: [] };
}

export function usedIn(ledger: BudgetLedgerT, scope: BudgetScope, per: WindowPer, nowMs: number): number {
  const calls = ledger.calls[scope].filter((ts) => inWindow(per, ts, nowMs)).length;
  const adjusted = ledger.adjustments
    .filter((adjustment) => adjustment.kind === scope && inWindow(per, Date.parse(adjustment.utc), nowMs))
    .reduce((sum, adjustment) => sum + adjustment.delta, 0);
  return Math.max(0, calls + adjusted);
}

export function refusingWindow(
  ledger: BudgetLedgerT,
  scope: BudgetScope,
  count: number,
  windows: BudgetWindow[],
  nowMs: number,
): BudgetWindow | null {
  return windows.find((window) =>
    usedIn(ledger, scope, window.per, nowMs) + count > window.cap - window.reserve) ?? null;
}

export function spend(ledger: BudgetLedgerT, scope: BudgetScope, count: number, nowMs: number): BudgetLedgerT {
  const stamped = [...ledger.calls[scope], ...Array<number>(count).fill(nowMs)];
  return { ...ledger, calls: { ...ledger.calls, [scope]: stamped } };
}

export function prune(ledger: BudgetLedgerT, windows: PlanWindows, nowMs: number): BudgetLedgerT {
  const live = (scope: BudgetScope, timestamp: number): boolean =>
    windows[scope].some((window) => inWindow(window.per, timestamp, nowMs));
  return {
    calls: {
      tier1: ledger.calls.tier1.filter((timestamp) => live("tier1", timestamp)),
      mcp: ledger.calls.mcp.filter((timestamp) => live("mcp", timestamp)),
    },
    adjustments: ledger.adjustments.filter((adjustment) => live(adjustment.kind, Date.parse(adjustment.utc))),
  };
}

export interface WindowUse extends BudgetWindow { scope: BudgetScope; used: number }

export function windowUse(ledger: BudgetLedgerT, windows: PlanWindows, nowMs: number): WindowUse[] {
  const scopes: BudgetScope[] = ["tier1", "mcp"];
  return scopes.flatMap((scope) =>
    windows[scope].map((window) => ({ ...window, scope, used: usedIn(ledger, scope, window.per, nowMs) })));
}

export function tightest(rows: WindowUse[], scope: BudgetScope): WindowUse | null {
  const headroom = (row: WindowUse): number => row.cap - row.reserve - row.used;
  return rows.filter((row) => row.scope === scope)
    .reduce<WindowUse | null>((best, row) =>
      best === null || headroom(row) < headroom(best) ? row : best, null);
}

export function budgetFailure(
  ledger: BudgetLedgerT,
  scope: BudgetScope,
  count: number,
  window: BudgetWindow,
  nowMs: number,
): RestFailure {
  const used = usedIn(ledger, scope, window.per, nowMs);
  return {
    kind: "budget",
    scope,
    per: window.per,
    used,
    cap: window.cap,
    reserve: window.reserve,
    detail: `${scope}/${window.per}: ${used} + ${count} > ${window.cap} - ${window.reserve}`,
  };
}

export interface Budget {
  spend(scope: BudgetScope, count: number): RestFailure | null;
  current(): WindowUse[];
}
