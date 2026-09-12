// REST adapter failures are values rather than exceptions. The CLI maps them to exit codes.

/** docs/reference/spec.md section 4.9: network and budget failures map to exit code 3; this library does not exit. */
export const EXIT_NETWORK = 3;

export type BudgetScope = "tier1" | "mcp";

export type RestFailure =
  /** Preserve the rejecting window because one scope can have several windows (docs/reference/spec.md section 4.10). */
  | { kind: "budget"; scope: BudgetScope; per: "minute" | "day" | "month"; used: number; cap: number; reserve: number; detail: string }
  /** Human-readable retry time in UTC ISO format for docs/reference/spec.md section 4.10 stderr output. */
  | { kind: "rate-limit"; retryAfterSec: number; retryAt: string; detail: string }
  /** Discovery count mismatch detected before spending budget on node batches. */
  | { kind: "discovery-count"; found: number; expected: number; bytes: number; detail: string }
  | { kind: "http"; status: number; detail: string }
  | { kind: "network"; detail: string };

export type RestResult<T> = { ok: true; value: T } | { ok: false; exitCode: typeof EXIT_NETWORK; failure: RestFailure };

export function ok<T>(value: T): RestResult<T> {
  return { ok: true, value };
}

export function err<T>(failure: RestFailure): RestResult<T> {
  return { ok: false, exitCode: EXIT_NETWORK, failure };
}
