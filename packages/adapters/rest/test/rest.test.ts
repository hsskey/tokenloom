// docs/reference/spec.md section 0.1, 4.1, 4.10, and section 8. All responses are typed synthetic values; no network access.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "@tokenloom/schema";
import {
  BATCH_SIZE, BUDGET_PATH, MCP_CAPTURE_COST, PLAN_BUDGETS, TIER1_CALL_COST,
  applyAdjustment, budgetFailure, chunk, createFileBudget, discoverSets,
  freshLedger, inWindow, planWindows, prune, restCapturePath, spend, tightest,
  getJson, monthKey, parseRetryAfter, parseVariantName, readLedger, refusingWindow,
  buildSnapshot, rateLimitHeaders, syncSnapshot, toAnnotations, toComponentSet, toDevmodeAnnotations,
  toRawNode, usedIn, windowUse,
  type Budget, type BudgetConfig, type BudgetLedgerT, type RestDeps, type RestResult,
} from "../src/index";
import {
  FILE_KEY, NOW_MS, buttonSetNode, comment, commentsResponse, fileResponse, headers, headersWithoutEntries,
  httpDeps, jsonResponse, nodesResponse, scriptedFetch,
} from "./samples";

/** Discovery depth matching the default `discoverDepth` in tokenloom.config.ts. */
const DEPTH = 4;

const CONFIG: BudgetConfig = {};

/** Mutable test clock used by window calculations. */
function clock(startMs = NOW_MS): { now: () => number; advance: (ms: number) => void } {
  let at = startMs;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tl-rest-"));
}

/** Create a ledger and throw setup failures outside test bodies. */
function newBudget(root = tempRoot(), plan = "starter", now: () => number = () => NOW_MS): Budget {
  const created = createFileBudget(root, plan, CONFIG, now);
  if (!created.ok) throw new Error(created.reason);
  return created.budget;
}

/** Ledger charged for `n` Tier 1 calls. */
function usedBudget(n: number, root = tempRoot()): Budget {
  const budget = newBudget(root);
  for (let i = 0; i < n; i += 1) budget.spend("tier1", TIER1_CALL_COST);
  return budget;
}

/** In-memory ledger with `n` records at one instant for window arithmetic tests. */
function ledgerAt(scope: "tier1" | "mcp", n: number, atMs: number): BudgetLedgerT {
  return spend(freshLedger(), scope, n, atMs);
}

function valueOf<T>(res: RestResult<T>): T {
  if (!res.ok) throw new Error(res.failure.detail);
  return res.value;
}

function restDeps(steps: Parameters<typeof scriptedFetch>[0], root: string, retryAfterMaxSec = 300): {
  deps: RestDeps;
  urls: string[];
  slept: number[];
} {
  const { fetch, urls } = scriptedFetch(steps);
  const { deps: http, slept } = httpDeps(fetch, retryAfterMaxSec);
  return { deps: { http, budget: newBudget(root), plan: "starter", discoverDepth: DEPTH }, urls, slept };
}

describe("budget ledger (docs/reference/spec.md section 4.10)", () => {
  it("uses UTC for month keys", () => {
    expect(monthKey(Date.parse("2026-09-30T23:30:00Z"))).toBe("2026-09");
    expect(monthKey(Date.parse("2026-10-01T00:00:00Z"))).toBe("2026-10");
    expect(monthKey(Date.parse("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("uses sliding minute and day windows and UTC calendar months", () => {
    const now = Date.parse("2026-10-01T00:00:30Z");
    expect(inWindow("minute", now - 59_999, now)).toBe(true);
    expect(inWindow("minute", now - 60_000, now)).toBe(false);
    expect(inWindow("day", now - 86_399_999, now)).toBe(true);
    expect(inWindow("day", now - 86_400_000, now)).toBe(false);
    // Calendar-month membership ignores elapsed time across the UTC month boundary.
    expect(inWindow("month", now - 31_000, now)).toBe(false);
    expect(inWindow("month", now + 1, now)).toBe(true);
  });

  it("enforces the Professional Tier 1 minute reserve and restores capacity after sixty seconds", () => {
    const c = clock();
    const budget = newBudget(tempRoot(), "pro", c.now);
    // A cap of ten with reserve two permits eight calls.
    for (let i = 0; i < 8; i += 1) expect(budget.spend("tier1", TIER1_CALL_COST)).toBeNull();
    expect(budget.spend("tier1", TIER1_CALL_COST)).toMatchObject({
      kind: "budget", scope: "tier1", per: "minute", used: 8, cap: 10, reserve: 2,
    });
    // 59.999 seconds remains inside the same sliding window.
    c.advance(59_999);
    expect(budget.spend("tier1", TIER1_CALL_COST)?.kind).toBe("budget");
    c.advance(1);
    expect(budget.spend("tier1", TIER1_CALL_COST)).toBeNull();
  });

  it("enforces both day and minute windows for Professional MCP calls", () => {
    const c = clock();
    const budget = newBudget(tempRoot(), "pro", c.now);
    // Three captures consume nine units, reaching the minute cap after reserve.
    for (let i = 0; i < 3; i += 1) expect(budget.spend("mcp", MCP_CAPTURE_COST)).toBeNull();
    expect(budget.spend("mcp", MCP_CAPTURE_COST)).toMatchObject({ per: "minute", used: 9, cap: 10, reserve: 1 });
    // The minute window clears while the day window continues accumulating to 180 after reserve.
    for (let i = 0; i < 57; i += 1) {
      c.advance(60_000);
      expect(budget.spend("mcp", MCP_CAPTURE_COST)).toBeNull();
    }
    c.advance(60_000);
    expect(budget.spend("mcp", MCP_CAPTURE_COST)).toMatchObject({ per: "day", used: 180, cap: 200, reserve: 20 });
  });

  it("uses one monthly window for Starter and resets usage across month boundaries", () => {
    const c = clock(Date.parse("2026-09-30T23:59:00Z"));
    const budget = newBudget(tempRoot(), "starter", c.now);
    // A cap of twenty with reserve five permits fifteen calls.
    for (let i = 0; i < 15; i += 1) expect(budget.spend("tier1", TIER1_CALL_COST)).toBeNull();
    expect(budget.spend("tier1", TIER1_CALL_COST)).toMatchObject({ per: "month", used: 15, cap: 20, reserve: 5 });
    c.advance(60_000);
    expect(budget.spend("tier1", TIER1_CALL_COST)).toBeNull();
    expect(tightest(budget.current(), "tier1")).toEqual({ scope: "tier1", per: "month", cap: 20, reserve: 5, used: 1 });
  });

  it("charges three units per MCP capture and one per REST Tier 1 call", () => {
    expect(MCP_CAPTURE_COST).toBe(3);
    expect(TIER1_CALL_COST).toBe(1);
    const windows = PLAN_BUDGETS.starter.mcp;
    expect(refusingWindow(ledgerAt("mcp", 12, NOW_MS), "mcp", MCP_CAPTURE_COST, windows, NOW_MS)).toBeNull();
    expect(refusingWindow(ledgerAt("mcp", 13, NOW_MS), "mcp", MCP_CAPTURE_COST, windows, NOW_MS)?.per).toBe("month");
  });

  it("overrides only cap and reserve in the selected plan row", () => {
    expect(planWindows("pro", {})).toEqual(PLAN_BUDGETS.pro);
    expect(planWindows("pro", { overrides: { "tier1.minute": { reserve: 5 } } })?.tier1)
      .toEqual([{ per: "minute", cap: 10, reserve: 5 }]);
    expect(planWindows("starter", { overrides: { "mcp.month": { cap: 8 } } })?.mcp)
      .toEqual([{ per: "month", cap: 8, reserve: 5 }]);
  });

  it("rejects plans without a column in docs/reference/spec.md section 0", () => {
    expect(planWindows("org", CONFIG)).toBeNull();
    expect(createFileBudget(tempRoot(), "org", CONFIG, () => NOW_MS))
      .toEqual({ ok: false, reason: 'no budget window for plan "org" (docs/reference/spec.md section 0)' });
  });

  it("prunes records outside every active window", () => {
    const old = spend(ledgerAt("mcp", 4, NOW_MS - 86_400_001), "mcp", 2, NOW_MS);
    const pruned = prune(old, PLAN_BUDGETS.pro, NOW_MS);
    expect(pruned.calls.mcp).toEqual([NOW_MS, NOW_MS]);
    // Starter records remain throughout the same calendar month.
    expect(prune(old, PLAN_BUDGETS.starter, NOW_MS).calls.mcp).toHaveLength(6);
  });

  it("reduces window usage by evidence-backed reversals", () => {
    const root = tempRoot();
    // Evidence must exist at the repository-relative path.
    writeFileSync(join(root, "evidence.jsonl"), "{}\n");
    const applied = applyAdjustment(root, ledgerAt("mcp", 6, NOW_MS), {
      utc: "2026-09-02T10:00:00Z", kind: "mcp" as const, delta: -3,
      reason: "zero Figma calls", evidence: "evidence.jsonl",
    });
    expect(applied.ok).toBe(true);
    const next = applied.ok ? applied.ledger : freshLedger();
    // Records remain for audit while calculated usage decreases.
    expect(next.calls.mcp).toHaveLength(6);
    expect(usedIn(next, "mcp", "month", NOW_MS)).toBe(3);
    expect(usedIn(next, "tier1", "month", NOW_MS)).toBe(0);
  });

  it("applies reversals only to containing windows and never produces negative usage", () => {
    const root = tempRoot();
    writeFileSync(join(root, "evidence.jsonl"), "{}\n");
    const applied = applyAdjustment(root, ledgerAt("mcp", 1, NOW_MS), {
      utc: "2026-09-02T10:00:00Z", kind: "mcp" as const, delta: -3,
      reason: "zero Figma calls", evidence: "evidence.jsonl",
    });
    const next = applied.ok ? applied.ledger : freshLedger();
    // Clamp one minus three to zero so a reversal cannot undercount later windows.
    expect(usedIn(next, "mcp", "month", NOW_MS)).toBe(0);
    // Neither the record nor reversal enters a minute window one day later.
    const later = NOW_MS + 86_400_000;
    expect(usedIn(next, "mcp", "minute", later)).toBe(0);
  });

  it("rejects a reversal whose evidence file is missing", () => {
    const applied = applyAdjustment(tempRoot(), freshLedger(), {
      utc: "2026-09-02T10:00:00Z", kind: "mcp" as const, delta: -3,
      reason: "missing evidence", evidence: "runs/out/nope.jsonl",
    });
    expect(applied).toEqual({ ok: false, reason: "missing evidence at runs/out/nope.jsonl" });
  });

  it("checks caps against usage after applying reversals", () => {
    const root = tempRoot();
    writeFileSync(join(root, "evidence.jsonl"), "{}\n");
    const windows = PLAN_BUDGETS.starter.mcp;
    const at15 = ledgerAt("mcp", 15, NOW_MS);
    // Usage fifteen against cap twenty and reserve five leaves no capacity.
    expect(refusingWindow(at15, "mcp", MCP_CAPTURE_COST, windows, NOW_MS)?.per).toBe("month");
    const applied = applyAdjustment(root, at15, {
      utc: "2026-09-02T10:00:00Z", kind: "mcp" as const, delta: -3,
      reason: "zero Figma calls", evidence: "evidence.jsonl",
    });
    const next = applied.ok ? applied.ledger : at15;
    // After reversal, one three-unit capture exactly reaches available capacity.
    expect(refusingWindow(next, "mcp", MCP_CAPTURE_COST, windows, NOW_MS)).toBeNull();
    // Failure reporting uses adjusted usage rather than the raw record count.
    const at18 = ledgerAt("mcp", 18, NOW_MS);
    const reversed = applyAdjustment(root, at18, {
      utc: "2026-09-02T10:00:00Z", kind: "mcp" as const, delta: -3,
      reason: "zero Figma calls", evidence: "evidence.jsonl",
    });
    const shown = reversed.ok ? reversed.ledger : at18;
    expect(budgetFailure(shown, "mcp", MCP_CAPTURE_COST, windows[0] as typeof windows[number], NOW_MS))
      .toMatchObject({ kind: "budget", scope: "mcp", per: "month", used: 15, cap: 20, reserve: 5 });
  });

  it("records usage before a successful spend returns", () => {
    const root = tempRoot();
    const budget = newBudget(root);
    expect(budget.spend("tier1", TIER1_CALL_COST)).toBeNull();
    const onDisk = JSON.parse(readFileSync(join(root, BUDGET_PATH), "utf8")) as { calls: { tier1: number[] } };
    expect(onDisk.calls.tier1).toEqual([NOW_MS]);
    expect(tightest(budget.current(), "tier1")?.used).toBe(1);
  });

  it("returns budget failure as a value without recording it", () => {
    const budget = usedBudget(15);
    expect(budget.spend("tier1", TIER1_CALL_COST)).toEqual({
      kind: "budget", scope: "tier1", per: "month", used: 15, cap: 20, reserve: 5,
      detail: "tier1/month: 15 + 1 > 20 - 5",
    });
    expect(tightest(budget.current(), "tier1")?.used).toBe(15);
  });

  it("rejects legacy ledgers with a reason containing the file path", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".tokenloom"), { recursive: true });
    writeFileSync(join(root, BUDGET_PATH), JSON.stringify({
      month: "2026-09", tier1: { used: 9, cap: 20 }, mcp: { used: 15, cap: 20 },
    }));
    // Legacy entries lack timestamps, so assigning one could undercount sliding windows.
    expect(readLedger(root)).toEqual({
      ok: false, reason: `legacy month-format ledger at ${BUDGET_PATH}; delete it and run again`,
    });
    expect(createFileBudget(root, "pro", CONFIG, () => NOW_MS).ok).toBe(false);
  });

  it("fails to read a malformed ledger instead of resetting usage to zero", () => {
    const root = tempRoot();
    usedBudget(1, root);
    writeFileSync(join(root, BUDGET_PATH), "{ not json");
    expect(readLedger(root)).toEqual({ ok: false, reason: `corrupt ledger at ${BUDGET_PATH}` });
    expect(createFileBudget(root, "pro", CONFIG, () => NOW_MS).ok).toBe(false);
  });

  it("treats a missing ledger as the first call", () => {
    expect(readLedger(tempRoot())).toEqual({ ok: true, ledger: freshLedger() });
  });

  it("reports each scope window and identifies the one with least headroom", () => {
    const rows = windowUse(ledgerAt("mcp", 9, NOW_MS), PLAN_BUDGETS.pro, NOW_MS);
    expect(rows).toEqual([
      { scope: "tier1", per: "minute", cap: 10, reserve: 2, used: 0 },
      { scope: "mcp", per: "day", cap: 200, reserve: 20, used: 9 },
      { scope: "mcp", per: "minute", cap: 10, reserve: 1, used: 9 },
    ]);
    // The day window has headroom while the minute window blocks the next call.
    expect(tightest(rows, "mcp")?.per).toBe("minute");
    expect(tightest(rows, "tier1")?.per).toBe("minute");
  });
});

describe("429 and 5xx policy (docs/reference/spec.md section 8)", () => {
  it("parses Retry-After as seconds or HTTP date and treats absence as infinity", () => {
    expect(parseRetryAfter("120", NOW_MS)).toBe(120);
    expect(parseRetryAfter("397000", NOW_MS)).toBe(397000);
    expect(parseRetryAfter(null, NOW_MS)).toBe(Number.POSITIVE_INFINITY);
    expect(parseRetryAfter("", NOW_MS)).toBe(Number.POSITIVE_INFINITY);
    expect(parseRetryAfter("Wed, 02 Sep 2026 10:01:00 GMT", NOW_MS)).toBe(60);
  });

  it("retries exactly once when Retry-After is within the configured limit", async () => {
    const { fetch, urls } = scriptedFetch([
      jsonResponse(429, {}, { "retry-after": "30" }),
      jsonResponse(200, { version: "v1" }),
    ]);
    const { deps, slept } = httpDeps(fetch, 300);
    const budget = newBudget();
    const res = await getJson<{ version: string }>(deps, "https://x/one", () => budget.spend("tier1", TIER1_CALL_COST));
    expect(valueOf(res)).toEqual({ version: "v1" });
    expect(urls).toEqual(["https://x/one", "https://x/one"]);
    expect(slept).toEqual([30_000]);
    // A retry is another physical call and incurs another ledger charge.
    expect(tightest(budget.current(), "tier1")?.used).toBe(2);
  });

  it("returns retry time without retrying when Retry-After exceeds the limit", async () => {
    const { fetch, urls } = scriptedFetch([jsonResponse(429, {}, { "retry-after": "397000" })]);
    const { deps, slept } = httpDeps(fetch, 300);
    const res = await getJson<unknown>(deps, "https://x/one", () => null);
    expect(res).toEqual({
      ok: false,
      exitCode: 3,
      failure: {
        kind: "rate-limit",
        retryAfterSec: 397000,
        retryAt: "2026-09-07T00:16:40Z",
        detail: "429 from https://x/one",
      },
    });
    expect(urls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("uses configured retryAfterMaxSec and does not wait thirty seconds when the limit is ten", async () => {
    const { fetch, urls } = scriptedFetch([
      jsonResponse(429, {}, { "retry-after": "30" }),
      jsonResponse(200, { version: "v1" }),
    ]);
    const { deps, slept } = httpDeps(fetch, 10);
    const res = await getJson<unknown>(deps, "https://x/one", () => null);
    expect(res.ok).toBe(false);
    expect(urls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("does not retry a second 429 response", async () => {
    const { fetch, urls } = scriptedFetch([
      jsonResponse(429, {}, { "retry-after": "5" }),
      jsonResponse(429, {}, { "retry-after": "5" }),
    ]);
    const { deps } = httpDeps(fetch, 300);
    const res = await getJson<unknown>(deps, "https://x/one", () => null);
    expect(res.ok).toBe(false);
    expect(urls).toHaveLength(2);
  });

  it("retries 5xx twice with exponential backoff and charges every attempt", async () => {
    const { fetch, urls } = scriptedFetch([jsonResponse(503, {})]);
    const { deps, slept } = httpDeps(fetch);
    const budget = newBudget();
    const res = await getJson<unknown>(deps, "https://x/one", () => budget.spend("tier1", TIER1_CALL_COST));
    expect(res).toEqual({ ok: false, exitCode: 3, failure: { kind: "http", status: 503, detail: "503 from https://x/one" } });
    expect(urls).toHaveLength(3);
    expect(slept).toEqual([500, 1000]);
    // docs/reference/spec.md section 4.10 counts failed calls, so three 503 responses cost three Tier 1 units.
    expect(tightest(budget.current(), "tier1")?.used).toBe(3);
  });

  it("does not retry 4xx and returns network failure when fetch throws", async () => {
    const { deps: a } = httpDeps(scriptedFetch([jsonResponse(403, {})]).fetch);
    expect(await getJson<unknown>(a, "https://x/v", () => null)).toEqual({
      ok: false, exitCode: 3, failure: { kind: "http", status: 403, detail: "403 from https://x/v" },
    });
    const { deps: b } = httpDeps(scriptedFetch([new Error("ECONNRESET")]).fetch);
    expect(await getJson<unknown>(b, "https://x/v", () => null)).toEqual({
      ok: false, exitCode: 3, failure: { kind: "network", detail: "ECONNRESET" },
    });
  });

  it("returns budget failure before calling fetch", async () => {
    const { fetch, urls } = scriptedFetch([jsonResponse(200, {})]);
    const { deps } = httpDeps(fetch);
    const res = await getJson<unknown>(deps, "https://x/one", () => ({
      kind: "budget", scope: "tier1", per: "month", used: 15, cap: 20, reserve: 5, detail: "x",
    }));
    expect(res.ok).toBe(false);
    expect(urls).toEqual([]);
  });
});

describe("REST to Snapshot mapping (docs/reference/spec.md section 4.1)", () => {
  it("parses variant names into props", () => {
    expect(parseVariantName("variant=primary, size=md")).toEqual({ variant: "primary", size: "md" });
    expect(parseVariantName("Button")).toEqual({});
    expect(parseVariantName("state=hover")).toEqual({ state: "hover" });
  });

  it("defaults missing visible to true and null absoluteBoundingBox to a zero box", () => {
    const node = toRawNode({ id: "1:1", name: "Ghost", type: "FRAME", absoluteBoundingBox: null });
    expect(node.visible).toBe(true);
    expect(node.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(toRawNode({ id: "1:2", name: "Hidden", type: "FRAME", visible: false }).visible).toBe(false);
  });

  it("docs/reference/spec.md section 4.1: removes the first hidden fill together with its binding", () => {
    const node = toRawNode({
      id: "1:9", name: "Box", type: "FRAME",
      fills: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: false, blendMode: "NORMAL" },
        { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, blendMode: "NORMAL" },
      ],
      boundVariables: { fills: [{ id: "vHidden", type: "VARIABLE_ALIAS" }] },
    });
    expect(node.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]);
    expect(node.bound.fill).toBe(undefined);
  });

  it("docs/reference/spec.md section 4.1: assigns the first remaining fill binding to bound.fill", () => {
    const node = toRawNode({
      id: "1:9", name: "Box", type: "FRAME",
      fills: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: false, blendMode: "NORMAL" },
        { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, blendMode: "NORMAL" },
      ],
      boundVariables: { fills: [{ id: "vHidden", type: "VARIABLE_ALIAS" }, { id: "vShown", type: "VARIABLE_ALIAS" }] },
    });
    expect(node.bound.fill).toBe("vShown");
  });

  it("docs/reference/spec.md section 4.1: prefers paint boundVariables.color over the node-level array", () => {
    const node = toRawNode({
      id: "1:9", name: "Box", type: "FRAME",
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, blendMode: "NORMAL", boundVariables: { color: { id: "vPaint", type: "VARIABLE_ALIAS" } } }],
      boundVariables: { fills: [{ id: "vNode", type: "VARIABLE_ALIAS" }] },
    });
    expect(node.bound.fill).toBe("vPaint");
  });

  it("docs/reference/spec.md section 4.1: keeps a binding paired with the remaining stroke after removing a non-SOLID stroke", () => {
    const node = toRawNode({
      id: "1:9", name: "Box", type: "FRAME", strokeWeight: 3,
      strokes: [
        { type: "GRADIENT_LINEAR", gradientHandlePositions: [], gradientStops: [], blendMode: "NORMAL" },
        { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, blendMode: "NORMAL" },
      ],
      boundVariables: { strokes: [{ id: "vGradient", type: "VARIABLE_ALIAS" }, { id: "vSolid", type: "VARIABLE_ALIAS" }] },
    });
    expect(node.strokes).toEqual([{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 3 }]);
    expect(node.bound.stroke).toBe("vSolid");
  });

  it("docs/reference/spec.md section 4.1: maps boundVariables.strokeWeight to bound.strokeWeight", () => {
    const node = toRawNode({
      id: "1:9", name: "Box", type: "FRAME", strokeWeight: 1,
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, blendMode: "NORMAL" }],
      boundVariables: { strokeWeight: { id: "vWeight", type: "VARIABLE_ALIAS" } },
    });
    expect(node.bound.strokeWeight).toBe("vWeight");
    expect(toRawNode({ id: "1:9", name: "Box", type: "FRAME" }).bound.strokeWeight).toBe(undefined);
  });

  it("derives props from child-name unions when componentPropertyDefinitions is absent", () => {
    const node = buttonSetNode();
    const set = toComponentSet({ ...node, componentPropertyDefinitions: undefined });
    expect(set?.props).toEqual({ size: ["md"], variant: ["primary", "secondary"] });
  });

  it("returns null for nodes other than COMPONENT_SET", () => {
    expect(toComponentSet({ id: "1:1", name: "Frame", type: "FRAME" })).toBeNull();
  });

  it("keeps top-level node comments while omitting canvas comments and replies", () => {
    // buildSnapshot sorts once after combining both sources.
    expect(toAnnotations(commentsResponse().comments)).toEqual([
      { nodeId: "12:36", text: "[a11y] 라벨은 시각적으로 숨기지 않는다.", author: "designer", source: "comment" },
      { nodeId: "12:34", text: "[behavior] Enter/Space로 활성화.", author: "designer", source: "comment" },
    ]);
  });

  it("collects Dev Mode labels from descendants without adding an author", () => {
    // real-annotated-theme node `1:10` is a descendant TEXT node, proving roots alone are insufficient.
    const child = { ...buttonSetNode(), id: "1:10", annotations: [{ label: "[a11y] 라벨" }] };
    const root = { ...buttonSetNode(), id: "1:13", annotations: [{ label: "[behavior] Enter" }], children: [child] };

    expect(toDevmodeAnnotations([root])).toEqual([
      { nodeId: "1:13", text: "[behavior] Enter", source: "devmode" },
      { nodeId: "1:10", text: "[a11y] 라벨", source: "devmode" },
    ]);
  });

  it("omits annotations with missing, non-string, empty, or properties-only labels", () => {
    // Properties-only entries pin values rather than carrying intent text and are outside docs/reference/spec.md section 4.8.
    const onlyProperties = [{ properties: [{ type: "padding" }] }];

    expect(toDevmodeAnnotations([
      { id: "1:10", annotations: [{}, { label: "" }, { label: 7 }] },
      { id: "1:11", annotations: onlyProperties },
      { id: "1:12" },
    ])).toEqual([]);
  });

  it("uses only label text when label and properties are both present", () => {
    const both = [{ label: "[a11y] 라벨", properties: [{ type: "padding" }, { type: "itemSpacing" }] }];

    expect(toDevmodeAnnotations([{ id: "1:10", annotations: both }])).toEqual([
      { nodeId: "1:10", text: "[a11y] 라벨", source: "devmode" },
    ]);
  });

  it("docs/reference/spec.md section 4.8: records annotationsSupport as read even when no annotations exist", () => {
    const snapshot = buildSnapshot({
      fileKey: FILE_KEY, fileVersion: "1", fetchedAt: "2026-09-02T10:00:00.000Z", plan: "pro",
      componentSets: [], textStyles: [], annotations: [],
    });

    expect(snapshot.source.annotationsSupport).toBe("read");
  });

  it("docs/reference/spec.md section 4.8: combines both annotation sources in code-point order by nodeId and text", () => {
    // `10:1` and `1:10` distinguish code-point order from localeCompare; plugin and REST must match.
    const snapshot = buildSnapshot({
      fileKey: FILE_KEY, fileVersion: "1", fetchedAt: "2026-09-02T10:00:00.000Z", plan: "pro",
      componentSets: [], textStyles: [],
      annotations: [
        ...toDevmodeAnnotations([
          { id: "1:10", annotations: [{ label: "[a11y] 라벨" }] },
          { id: "10:1", annotations: [{ label: "[behavior] Enter" }] },
        ]),
        ...toAnnotations([comment("c1", "[intent] 코멘트", "1:10")]),
      ],
    });

    expect(snapshot.annotations).toEqual([
      { nodeId: "10:1", text: "[behavior] Enter", source: "devmode" },
      { nodeId: "1:10", text: "[a11y] 라벨", source: "devmode" },
      { nodeId: "1:10", text: "[intent] 코멘트", author: "designer", source: "comment" },
    ]);
  });

  it("selects only COMPONENT_SET IDs and filters by name when provided", () => {
    expect(discoverSets(fileResponse(["12:34", "12:99"])).map((s) => s.id)).toEqual(["12:34", "12:99"]);
    expect(discoverSets(fileResponse(["12:34"]), ["Button"]).map((s) => s.id)).toEqual(["12:34"]);
    expect(discoverSets(fileResponse(["12:34"]), ["Card"])).toEqual([]);
  });

  it("finds sets nested in a frame rather than directly under the page", () => {
    expect(discoverSets(fileResponse(["12:34", "12:99"], true)).map((s) => s.id)).toEqual(["12:34", "12:99"]);
    expect(discoverSets(fileResponse(["12:34"], true), ["Card"])).toEqual([]);
  });

  it("finds sets inside a SECTION below depth two and preserves the parent chain", () => {
    // Page, frame, section, then set places the set at depth four.
    expect(discoverSets(fileResponse(["12:34", "12:99"], "section"))).toEqual([
      { id: "12:34", parents: ["Page 1", "Components", "Buttons"] },
      { id: "12:99", parents: ["Page 1", "Components", "Buttons"] },
    ]);
    // A direct page child has only the page in its parent chain.
    expect(discoverSets(fileResponse(["12:34"]))).toEqual([{ id: "12:34", parents: ["Page 1"] }]);
  });
});

describe("sync (docs/reference/spec.md section 0.1, 4.9)", () => {
  it("uses one discovery and one node batch and parses the result as a Snapshot", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps(
      [jsonResponse(200, fileResponse()), jsonResponse(200, nodesResponse(["12:34"]))],
      root,
    );
    const value = valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY }));
    expect(value.tier1Calls).toBe(2);
    expect(tightest(deps.budget.current(), "tier1")?.used).toBe(2);
    expect(urls).toEqual([
      `https://api.figma.com/v1/files/FILEKEY?depth=${DEPTH}`,
      "https://api.figma.com/v1/files/FILEKEY/nodes?ids=12%3A34",
    ]);
    expect(Snapshot.parse(value.snapshot).componentSets[0]?.name).toBe("Button");
    expect(value.snapshot.source.fetchedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(value.snapshot.textStyles.map((t) => t.name)).toEqual(["label/md"]);
  });

  it("never adds a geometry parameter to request URLs", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps(
      [jsonResponse(200, fileResponse()), jsonResponse(200, nodesResponse(["12:34"]))],
      root,
    );
    await syncSnapshot(deps, { fileKey: FILE_KEY });
    expect(urls.filter((u) => u.includes("geometry"))).toEqual([]);
  });

  it("batches fifty node IDs so 120 sets require three batches", async () => {
    expect(BATCH_SIZE).toBe(50);
    expect(chunk(Array.from({ length: 120 }, (_, i) => i), BATCH_SIZE).map((c) => c.length)).toEqual([50, 50, 20]);
    const ids = Array.from({ length: 120 }, (_, i) => `12:${i}`);
    const root = tempRoot();
    const { deps, urls } = restDeps(
      [jsonResponse(200, fileResponse(ids)), jsonResponse(200, nodesResponse(ids))],
      root,
    );
    expect(valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY })).tier1Calls).toBe(4);
    expect(urls).toHaveLength(4);
    expect(urls[1]?.split(",")).toHaveLength(50);
  });

  it("does not charge Tier 1 budget for Tier 2 comments", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps(
      [
        jsonResponse(200, fileResponse()),
        jsonResponse(200, nodesResponse(["12:34"])),
        jsonResponse(200, commentsResponse()),
      ],
      root,
    );
    const value = valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY, withComments: true }));
    expect(value.tier1Calls).toBe(2);
    expect(tightest(deps.budget.current(), "tier1")?.used).toBe(2);
    expect(urls[2]).toBe("https://api.figma.com/v1/files/FILEKEY/comments");
    expect(value.snapshot.annotations.map((a) => a.nodeId)).toEqual(["12:34", "12:36"]);
  });

  it("returns exit code 3 without discovery when no budget remains", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps([jsonResponse(200, fileResponse())], root);
    usedBudget(15, root);
    const res = await syncSnapshot({ ...deps, budget: newBudget(root) }, { fileKey: FILE_KEY });
    expect(res).toEqual({
      ok: false,
      exitCode: 3,
      failure: {
        kind: "budget", scope: "tier1", per: "month", used: 15, cap: 20, reserve: 5,
        detail: "tier1/month: 15 + 1 > 20 - 5",
      },
    });
    expect(urls).toEqual([]);
  });

  it("returns only the named set when a name is provided", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps([jsonResponse(200, fileResponse(["12:34"]))], root);
    const value = valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY, setNames: ["Card"] }));
    expect(value.snapshot.componentSets).toEqual([]);
    expect(value.tier1Calls).toBe(1);
    expect(urls).toHaveLength(1);
  });

  it("places the configured discovery depth in the URL", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps([jsonResponse(200, fileResponse())], root);
    await syncSnapshot({ ...deps, discoverDepth: 7 }, { fileKey: FILE_KEY, expectSets: 0 });
    expect(urls[0]).toBe("https://api.figma.com/v1/files/FILEKEY?depth=7");
  });

  it("stores the parent chain of a set inside SECTION in Snapshot extra", async () => {
    const root = tempRoot();
    const { deps } = restDeps(
      [jsonResponse(200, fileResponse(["12:34"], "section")), jsonResponse(200, nodesResponse(["12:34"]))],
      root,
    );
    const value = valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY }));
    expect(value.setsFound).toBe(1);
    expect(value.snapshot.componentSets[0]?.extra).toEqual({ parents: ["Page 1", "Components", "Buttons"] });
  });

  it("stops before node batching when discovered set count differs from expected", async () => {
    const root = tempRoot();
    const body = fileResponse(["12:34"]);
    const { deps, urls } = restDeps(
      [jsonResponse(200, body), jsonResponse(200, nodesResponse(["12:34"]))],
      root,
    );
    const res = await syncSnapshot(deps, { fileKey: FILE_KEY, expectSets: 4 });
    expect(res).toEqual({
      ok: false,
      exitCode: 3,
      failure: {
        kind: "discovery-count", found: 1, expected: 4,
        // Discovery remains charged and its measured size supports the next decision.
        bytes: Buffer.byteLength(JSON.stringify(body), "utf8"),
        detail: "discovery found 1 component sets, expected 4",
      },
    });
    // Only discovery ran; no batch call or additional ledger charge occurred.
    expect(urls).toHaveLength(1);
    expect(tightest(deps.budget.current(), "tier1")?.used).toBe(1);
  });

  it("continues to node batching when discovered set count matches expected", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps(
      [jsonResponse(200, fileResponse(["12:34"])), jsonResponse(200, nodesResponse(["12:34"]))],
      root,
    );
    const value = valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY, expectSets: 1 }));
    expect(urls).toHaveLength(2);
    expect(value.tier1Calls).toBe(2);
  });

  it("raw-response paths contain fileKey, UTC, and endpoint", () => {
    expect(restCapturePath("SAMPLEKEY00000000000AB", "2026-09-03", "files-depth4"))
      .toBe("samples/captures/rest/SAMPLEKEY00000000000AB/2026-09-03/files-depth4.json");
    expect(restCapturePath("FILEKEY", "2026-09-03", "nodes-batch-1"))
      .toBe("samples/captures/rest/FILEKEY/2026-09-03/nodes-batch-1.json");
    // Remove characters that cannot appear in path segments.
    expect(restCapturePath("a/../b", "2026-09-03", "comments"))
      .toBe("samples/captures/rest/a-..-b/2026-09-03/comments.json");
  });

  it("preserves the raw comments response", async () => {
    const root = tempRoot();
    const body = commentsResponse();
    const { deps } = restDeps(
      [jsonResponse(200, fileResponse(["12:34"])), jsonResponse(200, nodesResponse(["12:34"])), jsonResponse(200, body)],
      root,
    );
    const seen: string[] = [];
    await syncSnapshot(deps, { fileKey: FILE_KEY, withComments: true, onRaw: (endpoint) => seen.push(endpoint) });
    expect(seen).toEqual([`files-depth${DEPTH}`, "nodes-batch-1", "comments"]);
  });

  it("never calls a Variables endpoint that would return 403", async () => {
    const root = tempRoot();
    const { deps, urls } = restDeps(
      [jsonResponse(200, fileResponse(["12:34"])), jsonResponse(200, nodesResponse(["12:34"])), jsonResponse(200, commentsResponse())],
      root,
    );
    // The Starter plan receives 403 from Variables REST and docs/reference/spec.md section 0 forbids the call.
    expect(deps.plan).toBe("starter");
    await syncSnapshot(deps, { fileKey: FILE_KEY, withComments: true });
    expect(urls.filter((u) => u.includes("variable"))).toEqual([]);
    expect(urls.map((u) => u.replace(/^.*\/v1\/files\/FILEKEY/, ""))).toEqual([
      `?depth=${DEPTH}`, "/nodes?ids=12%3A34", "/comments",
    ]);
  });

  it("passes labeled raw responses for discovery and every batch", async () => {
    // Raw responses answer source-field questions without another Tier 1 call.
    const root = tempRoot();
    const file = fileResponse(["12:34"]);
    const nodes = nodesResponse(["12:34"]);
    const { deps } = restDeps([jsonResponse(200, file), jsonResponse(200, nodes)], root);
    const raw: [string, string][] = [];
    await syncSnapshot(deps, { fileKey: FILE_KEY, onRaw: (label, body) => raw.push([label, body]) });
    expect(raw.map(([endpoint]) => endpoint)).toEqual([`files-depth${DEPTH}`, "nodes-batch-1"]);
    // Parsing and serializing would change source whitespace and key order.
    expect(raw[0]?.[1]).toBe(JSON.stringify(file));
    expect(raw[1]?.[1]).toBe(JSON.stringify(nodes));
  });

  it("preserves raw response whitespace without reserialization", async () => {
    const root = tempRoot();
    const file = fileResponse(["12:34"]);
    // Reserializing this indented body would alter its whitespace.
    const pretty = JSON.stringify(file, null, 2);
    const { fetch } = scriptedFetch([
      { status: 200, headers: headers(), text: async () => pretty },
      jsonResponse(200, nodesResponse(["12:34"])),
    ]);
    const { deps: http } = httpDeps(fetch, 300);
    const deps: RestDeps = { http, budget: newBudget(root), plan: "starter", discoverDepth: DEPTH };
    const raw: string[] = [];
    await syncSnapshot(deps, {
      fileKey: FILE_KEY,
      onRaw: (endpoint, body) => { if (endpoint.startsWith("files-depth")) raw.push(body); },
    });
    expect(raw[0]).toBe(pretty);
    expect(raw[0]).toContain("\n  ");
  });

  it("numbers multiple batch labels as nodes-1 and nodes-2", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `12:${i}`);
    const root = tempRoot();
    const { deps } = restDeps(
      [
        jsonResponse(200, fileResponse(ids)),
        jsonResponse(200, nodesResponse(ids)),
        jsonResponse(200, nodesResponse(ids)),
      ],
      root,
    );
    const labels: string[] = [];
    await syncSnapshot(deps, { fileKey: FILE_KEY, onRaw: (label) => labels.push(label) });
    expect(labels).toEqual([`files-depth${DEPTH}`, "nodes-batch-1", "nodes-batch-2"]);
  });

  it("returns the measured discovery-response byte count", async () => {
    const root = tempRoot();
    const body = fileResponse(["12:34"]);
    const { deps } = restDeps(
      [jsonResponse(200, body), jsonResponse(200, nodesResponse(["12:34"]))],
      root,
    );
    const value = valueOf(await syncSnapshot(deps, { fileKey: FILE_KEY }));
    expect(value.discoveryBytes).toBe(Buffer.byteLength(JSON.stringify(body), "utf8"));
  });
});

describe("rate-limit response header recording (docs/reference/spec.md sections 0 and 8)", () => {
  it("keeps only rate-limit headers in lowercase lexical order", () => {
    const got = rateLimitHeaders(headers({
      "Retry-After": "397000",
      "X-RateLimit-Remaining": "9",
      "ratelimit-reset": "60",
      "X-Figma-Request-Id": "req-7",
      "content-type": "application/json",
      etag: "W/\"abc\"",
    }));

    expect(got).toEqual({
      "ratelimit-reset": "60",
      "retry-after": "397000",
      "x-figma-request-id": "req-7",
      "x-ratelimit-remaining": "9",
    });
    expect(Object.keys(got)).toEqual([
      "ratelimit-reset", "retry-after", "x-figma-request-id", "x-ratelimit-remaining",
    ]);
  });

  it("redacts values of headers whose names contain token", () => {
    expect(rateLimitHeaders(headers({ "X-Figma-Token": "pat-secret" })))
      .toEqual({ "x-figma-token": "<redacted>" });
  });

  it("returns an empty object for non-iterable header implementations", () => {
    expect(rateLimitHeaders(headersWithoutEntries({ "retry-after": "60" }))).toEqual({});
  });

  it("passes response headers with each endpoint body to the raw-response hook", async () => {
    const root = tempRoot();
    const { deps } = restDeps(
      [
        jsonResponse(200, fileResponse(["12:34"]), { "x-ratelimit-remaining": "9", "content-type": "application/json" }),
        jsonResponse(200, nodesResponse(["12:34"]), { "retry-after": "3" }),
      ],
      root,
    );
    const seen: [string, Record<string, string>][] = [];

    await syncSnapshot(deps, {
      fileKey: FILE_KEY,
      onRaw: (endpoint, _body, head) => { seen.push([endpoint, rateLimitHeaders(head)]); },
    });

    expect(seen).toEqual([
      [`files-depth${DEPTH}`, { "x-ratelimit-remaining": "9" }],
      ["nodes-batch-1", { "retry-after": "3" }],
    ]);
  });
});
