import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../..");

interface WorkflowStep {
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface WorkflowJob {
  "runs-on"?: string;
  needs?: string[];
  if?: string;
  concurrency?: unknown;
  strategy?: { "fail-fast"?: boolean; matrix?: { index?: number[] } };
  steps?: WorkflowStep[];
}

interface ShardWorkflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: unknown;
  env?: { SHARD_COUNT?: number };
  jobs?: Record<string, WorkflowJob>;
}

const workflow = parse(readFileSync(resolve(root, ".github/workflows/verify-shard.yml"), "utf8")) as ShardWorkflow;
const jobs = workflow.jobs ?? {};
const stepsOf = (job: string): WorkflowStep[] => jobs[job]?.steps ?? [];
const verifyStep = (job: string): WorkflowStep | undefined => stepsOf(job).find((step) => step.run?.includes("verify"));
const uploadsOf = (job: string): Array<Pick<WorkflowStep, "if" | "with">> => stepsOf(job)
  .filter((step) => step.uses === "actions/upload-artifact@v4")
  .map((step) => ({ if: step.if, with: step.with }));

describe("shard experiment workflow", () => {
  it("runs only on manual dispatch, on standard runners, with read-only access and no cancellation policy", () => {
    expect({
      triggers: Object.keys(workflow.on ?? {}),
      permissions: workflow.permissions,
      runners: Object.values(jobs).map((job) => job["runs-on"]),
      concurrency: [workflow.concurrency, ...Object.values(jobs).map((job) => job.concurrency)].filter((c) => c !== undefined),
    }).toEqual({
      triggers: ["workflow_dispatch"],
      permissions: { contents: "read" },
      runners: ["ubuntu-latest", "ubuntu-latest", "ubuntu-latest"],
      concurrency: [],
    });
  });

  it("runs one independent job per shard, matching SHARD_COUNT", () => {
    expect({
      count: workflow.env?.SHARD_COUNT,
      matrix: jobs.shard?.strategy?.matrix?.index,
      failFast: jobs.shard?.strategy?.["fail-fast"],
    }).toEqual({ count: 4, matrix: [0, 1, 2, 3], failFast: false });
  });

  it("produces every record through the verifier's own selectors", () => {
    expect({
      host: verifyStep("host")?.run,
      shard: { run: verifyStep("shard")?.run, env: verifyStep("shard")?.env },
      aggregate: { if: verifyStep("aggregate")?.if, run: verifyStep("aggregate")?.run, env: verifyStep("aggregate")?.env },
    }).toEqual({
      host: "pnpm --silent verify --gate host > record.json",
      shard: {
        run: "pnpm --silent verify --shard-fragment > record.json",
        env: { TOKENLOOM_SELFTEST_SHARD: "${{ matrix.index }}/${{ env.SHARD_COUNT }}" },
      },
      aggregate: {
        if: "always()",
        run: "pnpm --silent verify --aggregate shard-artifacts --shards ${{ env.SHARD_COUNT }} > record.json",
        env: {
          TOKENLOOM_SHARD_HOST_RESULT: "${{ needs.host.result }}",
          TOKENLOOM_SHARD_FRAGMENTS_RESULT: "${{ needs.shard.result }}",
        },
      },
    });
  });

  it("merges after both producers finish, including when they fail", () => {
    expect({ needs: jobs.aggregate?.needs, if: jobs.aggregate?.if }).toEqual({ needs: ["host", "shard"], if: "always()" });
  });

  it("uploads distinct records even after a failed step, never under the authoritative report name", () => {
    expect({ host: uploadsOf("host"), shard: uploadsOf("shard"), aggregate: uploadsOf("aggregate") }).toEqual({
      host: [{ if: "always()", with: { name: "verify-shard-host", path: "record.json" } }],
      shard: [{ if: "always()", with: { name: "verify-shard-${{ matrix.index }}-of-${{ env.SHARD_COUNT }}", path: "record.json" } }],
      aggregate: [{ if: "always()", with: { name: "verify-shard-aggregate", path: "record.json" } }],
    });
  });
});
