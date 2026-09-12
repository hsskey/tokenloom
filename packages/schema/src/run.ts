import { z } from "zod";

/** One immutable CLI observation appended to the dated run ledger. */
export const RunRecord = z.object({
  cmd: z.string(),
  target: z.string(),
  bytesIn: z.number(),
  bytesOut: z.number(),
  ratio: z.number(),
  estTokens: z.number(),
  ms: z.record(z.string(), z.number()),
  warnings: z.number(),
});
export type RunRecordT = z.infer<typeof RunRecord>;

/**
 * The conservative value comes from measured JSON prompts at 2.86 to 3.02 bytes per token on 2026-09-03.
 * Adapter overhead is excluded, so small prompts are underestimated and corrected with usage data.
 */
export const BYTES_PER_TOKEN = 2.8;

export function estimateTokens(bytes: number): number {
  return Math.round(bytes / BYTES_PER_TOKEN);
}
