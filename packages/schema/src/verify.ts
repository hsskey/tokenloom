import { z } from "zod";

/**
 * Verification gates, named for the property each one protects. A report keys its results by these
 * names, so renaming one changes the committed verify.json shape.
 */
export const GateId = z.enum([
  "types", "patterns", "tests", "reference", "determinism", "properties", "mutations",
  "rules", "benchmarks", "scope", "scoring", "encoding", "selftest",
]);
export type GateIdT = z.infer<typeof GateId>;

/** Gate results include supporting measurements in addition to the verdict. */
export const GateResult = z.object({ pass: z.boolean().nullable() }).catchall(z.unknown());
export type GateResultT = z.infer<typeof GateResult>;

export const VerifyReport = z.object({
  commit: z.string(),
  utc: z.string(),
  node: z.string(),
  os: z.string(),
  durationSec: z.number(),
  gates: z.record(GateId, GateResult),
});
export type VerifyReportT = z.infer<typeof VerifyReport>;

/** Every gate runs on every verification; the list also fixes the order gates are reported in. */
export const ALL_GATES: GateIdT[] = GateId.options;
