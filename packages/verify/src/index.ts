import type { GateIdT, GateResultT } from "@tokenloom/schema";
import { ALL_GATES } from "@tokenloom/schema";
import type { VerifyContext, Gate } from "./verify-context";
import { types, patterns, scope, encoding } from "./gates/static";
import { tests, properties, rules, scoring, resetVitestCache } from "./gates/tests";
import { reference, determinism, mutations } from "./gates/reference";
import { benchmarks } from "./gates/bench";
import { selftest } from "./gates/meta";

export * from "./verify-context";
export * from "./synth";

/** Continues after a gate throws by normalizing the exception to pass:false. */
async function guard(id: GateIdT, gate: Gate, ctx: VerifyContext): Promise<GateResultT> {
  try {
    return await gate(ctx);
  } catch (error) {
    return { pass: false, reason: `${id} threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const GATES: Record<GateIdT, Gate> = {
  types, patterns, tests, reference, determinism, properties, mutations,
  rules, benchmarks, scope, scoring, encoding, selftest,
};

/**
 * The benchmark gate measures time and heap, so it runs alone after the others. The self-test gate
 * evaluates six copies in parallel; overlapping those measurements contaminates them. Sorted JSON
 * keys keep output bytes independent of execution order.
 */
const LAST_GATES = new Set<GateIdT>(["benchmarks"]);

export function runOrder(gates: GateIdT[]): GateIdT[] {
  return [...gates.filter((g) => !LAST_GATES.has(g)), ...gates.filter((g) => LAST_GATES.has(g))];
}

export async function runGates(ctx: VerifyContext, gates: GateIdT[]): Promise<Record<string, GateResultT>> {
  resetVitestCache(ctx.root);
  const out: Record<string, GateResultT> = {};
  for (const id of runOrder(gates)) out[id] = await guard(id, GATES[id], ctx);
  resetVitestCache(ctx.root);
  return out;
}

/** Runs every gate and reports them in the canonical order. */
export async function runAll(ctx: VerifyContext): Promise<Record<string, GateResultT>> {
  const results = await runGates(ctx, ALL_GATES);
  const full: Record<string, GateResultT> = {};
  for (const id of ALL_GATES) full[id] = results[id] ?? { pass: null };
  return full;
}
