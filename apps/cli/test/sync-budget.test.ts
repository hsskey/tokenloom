import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCOVERY_WARN_BYTES, diffPaths, discoveryWarning, fieldDiff, fileSha256 } from "../src/cmd-sync";

const repoRoot = resolve(import.meta.dirname, "../../..");
const CLI = resolve(repoRoot, "apps/cli/dist/tokenloom.js");

function runCli(args: string[], cwd: string, pathPrefix?: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")),
      FIGMA_TOKEN: "",
      ...(pathPrefix === undefined ? {} : { PATH: `${pathPrefix}:${process.env.PATH ?? ""}` }),
    },
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

/** Use a temporary root to keep the real budget ledger untouched. */
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "tl-repo-"));
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  // A valid child MCP configuration lets preflight reach the budget check.
  mkdirSync(join(dir, "eval"), { recursive: true });
  writeFileSync(
    join(dir, "eval/mcp-figma.json"),
    JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }),
  );
  return dir;
}

/** An unrelated MCP server intentionally violates capture preflight. */
function tempRepoBadMcp(): string {
  const dir = tempRepo();
  writeFileSync(
    join(dir, "eval/mcp-figma.json"),
    JSON.stringify({ mcpServers: { figma: {}, tolaria: {} } }),
  );
  return dir;
}

/** Use current timestamps so the ledger entries remain in their sliding windows. */
function writeLedger(root: string, calls: { tier1?: number[]; mcp?: number[] }): void {
  mkdirSync(join(root, ".tokenloom"), { recursive: true });
  writeFileSync(join(root, ".tokenloom/budget.json"), JSON.stringify({
    calls: { tier1: calls.tier1 ?? [], mcp: calls.mcp ?? [] }, adjustments: [],
  }));
}

/** Place each attempt in both the current minute and day windows. */
function nowCalls(n: number): number[] {
  return Array<number>(n).fill(Date.now());
}

/** A PATH shim records unexpected Claude invocations without allowing real model calls. */
function claudeShim(): { bin: string; marker: string } {
  const dir = mkdtempSync(join(tmpdir(), "tl-shim-"));
  const bin = join(dir, "bin");
  const marker = join(dir, "claude-was-called");
  mkdirSync(bin);
  const script = join(bin, "claude");
  writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\necho "fake claude: refused" >&2\nexit 1\n`);
  chmodSync(script, 0o755);
  return { bin, marker };
}

describe("budget command (docs/reference/spec.md section 4.10)", () => {
  it("a missing ledger starts each configured budget window at zero", () => {
    const res = runCli(["budget", "--json"], tempRepo());
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { plan: string; windows: { scope: string; per: string; used: number }[] };
    // The configured Pro plan uses one Tier 1 window and separate minute/day MCP windows.
    expect(out.plan).toBe("pro");
    expect(out.windows.map((w) => `${w.scope}/${w.per}`)).toEqual(["tier1/minute", "mcp/day", "mcp/minute"]);
    expect(out.windows.every((w) => w.used === 0)).toBe(true);
  });

  it("stderr lists each window with its cap and reserve", () => {
    const res = runCli(["budget"], tempRepo());
    expect(res.stderr).toContain("budget pro: tier1 per minute 0/10 (reserve 2)");
    expect(res.stderr).toContain("budget pro: mcp per day 0/200 (reserve 20)");
    expect(res.stderr).toContain("budget pro: mcp per minute 0/10 (reserve 1)");
  });

  it("legacy monthly ledgers are refused with exit code 3 instead of being migrated", () => {
    const root = tempRepo();
    mkdirSync(join(root, ".tokenloom"), { recursive: true });
    writeFileSync(join(root, ".tokenloom/budget.json"), JSON.stringify({
      month: "2026-09", tier1: { used: 9, cap: 20 }, mcp: { used: 15, cap: 20 },
    }));
    const res = runCli(["budget", "--json"], root);
    expect(res.status).toBe(3);
    expect(res.stderr).toContain("legacy month-format ledger");
    expect(res.stdout).toBe("");
  });

  it("corrupt ledgers are refused with exit code 3 instead of being reset", () => {
    const root = tempRepo();
    mkdirSync(join(root, ".tokenloom"), { recursive: true });
    writeFileSync(join(root, ".tokenloom/budget.json"), "{ not json");
    const res = runCli(["budget", "--json"], root);
    expect(res.status).toBe(3);
    expect(res.stdout).toBe("");
  });
});

describe("sync command (docs/reference/spec.md section 4.9)", () => {
  it("missing FIGMA_TOKEN exits with code 1 before network access", () => {
    const res = runCli(["sync", "--file", "ABC123"], tempRepo());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("FIGMA_TOKEN");
  });

  it("a missing file key in both flags and configuration exits with code 1", () => {
    const res = runCli(["sync"], tempRepo());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--file");
  });

  it("exhausted budgets exit with code 3 before a request", () => {
    const root = tempRepo();
    // Fill the configured Tier 1 window to its cap minus reserve.
    writeLedger(root, { tier1: nowCalls(8) });
    const res = spawnSync("node", [CLI, "sync", "--file", "ABC123"], {
      encoding: "utf8", cwd: root,
      env: { ...process.env, FIGMA_TOKEN: "figd_test", TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
    });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain("budget");
  });
});

describe("sample diff and response schema changes (docs/reference/spec.md section 8)", () => {
  it("identical snapshots produce no differences", () => {
    const snapshot = JSON.parse(readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8"));
    expect(fieldDiff(snapshot, snapshot)).toEqual([]);
  });

  it("only changed field paths are returned", () => {
    const left = { a: { b: 1, c: 2 }, d: 3 };
    const right = { a: { b: 1, c: 9 }, d: 3 };
    expect(fieldDiff(left, right)).toEqual(["/a/c"]);
  });

  it("keys present on only one side are included", () => {
    expect(fieldDiff({ a: 1 }, { a: 1, b: 2 })).toEqual(["/b"]);
  });

  it("arrays are represented by one complete field path", () => {
    expect(fieldDiff({ a: [1, 2] }, { a: [1, 3] })).toEqual(["/a"]);
  });

  it("ancestor metadata in extra is excluded from differences", () => {
    // REST-only ancestor metadata would otherwise create false differences against plugin snapshots.
    const plugin = { componentSets: [{ id: "12:34", name: "Button" }] };
    const rest = { componentSets: [{ id: "12:34", name: "Button", extra: { parents: ["Page 1", "Buttons"] } }] };
    // Comparing an array directly would report its entire component-set path.
    expect(fieldDiff(plugin, rest)).toEqual(["/componentSets"]);
    expect(diffPaths(plugin, rest)).toEqual([]);
    // Actual changes outside extra must still appear at the component-set array path.
    expect(diffPaths(plugin, { componentSets: [{ id: "12:34", name: "Btn" }] })).toEqual(["/componentSets"]);

    expect(diffPaths({ a: 1, extra: { parents: [] } }, { a: 2 })).toEqual(["/a"]);
  });

  it("comparison results include the input file SHA-256", () => {
    // Comparison snapshots are outside the reference manifest, so retain their provenance instead.
    const root = tempRepo();
    const snapshot = readFileSync(resolve(repoRoot, "samples/button/snapshot.json"), "utf8");
    mkdirSync(join(root, "samples/x"), { recursive: true });
    writeFileSync(join(root, "samples/x/snapshot.json"), snapshot);
    writeFileSync(join(root, "samples/x/snapshot.rest.json"), snapshot);

    const res = runCli(["samples", "diff", "--only", "x", "--json"], root);

    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { against: string; againstSha256: string; paths: string[] };
    // Repository-relative paths preserve identical output across machines.
    expect(out.against).toBe("samples/x/snapshot.rest.json");
    expect(out.againstSha256).toBe(fileSha256(join(root, "samples/x/snapshot.rest.json")));
    expect(out.againstSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(out.paths).toEqual([]);
  });

  it("missing --only exits with code 1", () => {
    const res = runCli(["samples", "diff"], repoRoot);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--only");
  });

  it("missing comparison inputs exit with code 1 and report both paths", () => {
    const res = runCli(["samples", "diff", "--only", "button"], repoRoot);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("snapshot.rest.json");
  });
});

describe("eval capture (docs/reference/spec.md section 9.3)", () => {
  it("inputs other than mcp exit with code 1", () => {
    const res = runCli(["eval", "capture", "--input", "snapshot", "--node", "1:2"], tempRepo());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--input mcp");
  });

  it("missing --node exits with code 1", () => {
    const res = runCli(["eval", "capture", "--input", "mcp"], tempRepo());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--node");
  });

  it("missing --file exits with code 1", () => {
    // All capture tools require fileKey; omitting it would waste a capture on empty results.
    const res = runCli(["eval", "capture", "--input", "mcp", "--node", "1:2"], tempRepo());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--file");
  });

  it("failed preflight leaves the ledger untouched and creates no stream file", () => {
    const root = tempRepoBadMcp();
    writeLedger(root, { mcp: nowCalls(6) });
    const before = readFileSync(join(root, ".tokenloom/budget.json"), "utf8");

    const res = runCli(["eval", "capture", "--input", "mcp", "--node", "1:2", "--file", "FILEKEY"], root);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("preflight failed (b) figma-only mcp config");
    // No reservation means no rollback or evidence file is needed.
    expect(readFileSync(join(root, ".tokenloom/budget.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, "runs"))).toBe(false);
  });

  it("TOKENLOOM_NO_SPAWN refuses child processes even when the MCP budget is available", () => {
    const root = tempRepo();
    writeLedger(root, { mcp: nowCalls(0) });
    const shim = claudeShim();

    const res = runCli(["eval", "capture", "--input", "mcp", "--node", "1:2", "--file", "FILEKEY"], root, shim.bin);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("eval capture: preflight failed (g) TOKENLOOM_NO_SPAWN is set, no child will be spawned");
  });

  it("process refusal never invokes the Claude executable on PATH", () => {
    const root = tempRepo();
    writeLedger(root, { mcp: nowCalls(0) });
    const shim = claudeShim();

    runCli(["eval", "capture", "--input", "mcp", "--node", "1:2", "--file", "FILEKEY"], root, shim.bin);

    expect(existsSync(shim.marker)).toBe(false);
  });

  it("preflight process refusal leaves budget-ledger bytes unchanged", () => {
    const root = tempRepo();
    writeLedger(root, { mcp: nowCalls(0) });
    const shim = claudeShim();
    const ledger = join(root, ".tokenloom/budget.json");
    const before = readFileSync(ledger);

    runCli(["eval", "capture", "--input", "mcp", "--node", "1:2", "--file", "FILEKEY"], root, shim.bin);

    expect(readFileSync(ledger).equals(before)).toBe(true);
  });

  it("exhausted MCP budgets exit with code 3 without invoking Claude", () => {
    const root = tempRepo();
    // Fill the MCP window so the reserved capture allowance cannot fit.
    writeLedger(root, { mcp: nowCalls(9) });
    // Remove the spawn guard only in this child so preflight can reach budget refusal.
    // The PATH shim still prevents real model calls if the budget guard fails.

    const shim = claudeShim();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")),
      PATH: `${shim.bin}:${process.env.PATH ?? ""}`,
    };
    delete env.TOKENLOOM_NO_SPAWN;

    const res = spawnSync("node", [CLI, "eval", "capture", "--input", "mcp", "--node", "1:2", "--file", "FILEKEY"], {
      encoding: "utf8", cwd: root, env,
    });

    expect(res.status).toBe(3);
    expect(res.stderr).toContain("budget exhausted");
    expect(existsSync(shim.marker)).toBe(false);
  });
});

describe("eval run child-process guard (docs/reference/spec.md section 9.2)", () => {
  /** Remove TOKENLOOM_LLM so this child selects the real adapter while retaining the spawn guard. */
  function realAdapterEnv(pathPrefix: string, runsDir: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, TOKENLOOM_RUNS_DIR: runsDir, PATH: `${pathPrefix}:${process.env.PATH ?? ""}` };
    delete env.TOKENLOOM_LLM;
    return env;
  }

  /** Read the plan once to compare the preflight refusal against its actual cost estimate. */
  function planEstTotalCostUsd(): number {
    const res = spawnSync("node", [CLI, "eval", "run", "--matrix", "eval/matrix.mvp.yaml", "--dry-run", "--json"], {
      encoding: "utf8", cwd: repoRoot,
      env: { ...process.env, TOKENLOOM_LLM: "fake", TOKENLOOM_RUNS_DIR: mkdtempSync(join(tmpdir(), "tl-runs-")) },
    });
    return (JSON.parse(res.stdout) as { estTotalCostUsd: number }).estTotalCostUsd;
  }

  // Keep the budget above the estimate so process refusal is tested before budget refusal.
  function runEval(shim: { bin: string }, runsDir: string, args: string[] = ["--budget-usd", "10"]): { status: number; stderr: string } {
    const res = spawnSync("node", [CLI, "eval", "run", "--matrix", "eval/matrix.mvp.yaml", ...args], {
      encoding: "utf8", cwd: repoRoot, env: realAdapterEnv(shim.bin, runsDir),
    });
    return { status: res.status ?? -1, stderr: res.stderr };
  }

  it("the real adapter stops with exit code 1 before spawning a child", () => {
    const shim = claudeShim();

    const res = runEval(shim, mkdtempSync(join(tmpdir(), "tl-runs-")));

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("spawn refused: TOKENLOOM_NO_SPAWN is set");
  });

  it("omitting --budget-usd uses the plan's recommendation", () => {
    const shim = claudeShim();

    const res = runEval(shim, mkdtempSync(join(tmpdir(), "tl-runs-")), []);

    // The recommendation and its basis appear before the child-process guard stops execution.
    expect(res.stderr).toContain("--budget-usd not given, using $");
    expect(res.stderr).not.toContain("--budget-usd is required");
    expect(existsSync(shim.marker)).toBe(false);
  });

  it("an explicit budget below the total estimate exits with code 3 before the first call", () => {
    const shim = claudeShim();
    const runsDir = mkdtempSync(join(tmpdir(), "tl-runs-"));
    const est = planEstTotalCostUsd();

    const res = runEval(shim, runsDir, ["--budget-usd", "0.5"]);

    expect(res.status).toBe(3);
    expect(res.stderr).toContain(`--budget-usd $0.5000 is below the plan's estTotalCostUsd $${est.toFixed(4)}`);
    expect(existsSync(shim.marker)).toBe(false);
    expect(readdirSync(runsDir)).toEqual([]);
  });

  it("refused runs never invoke the Claude executable on PATH", () => {
    const shim = claudeShim();

    runEval(shim, mkdtempSync(join(tmpdir(), "tl-runs-")));

    expect(existsSync(shim.marker)).toBe(false);
  });

  it("refused runs leave no run records", () => {
    // The runner writes nothing before send; appendRuns executes only after runMatrix completes.
    const shim = claudeShim();
    const runsDir = mkdtempSync(join(tmpdir(), "tl-runs-"));

    runEval(shim, runsDir);

    expect(readdirSync(runsDir)).toEqual([]);
  });
});

describe("Discovery response size warning (docs/reference/spec.md section 2.1)", () => {
  it("responses above 20 MB warn while smaller responses remain quiet", () => {
    expect(DISCOVERY_WARN_BYTES).toBe(20 * 1024 * 1024);
    expect(discoveryWarning(DISCOVERY_WARN_BYTES)).toBeNull();
    expect(discoveryWarning(1024)).toBeNull();
    const warning = discoveryWarning(DISCOVERY_WARN_BYTES + 1);
    expect(warning).toContain(`${DISCOVERY_WARN_BYTES + 1}B exceeds`);
  });
});
