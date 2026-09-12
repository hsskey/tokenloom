# trajectory-handwritten-number

`apply/packages/eval/src/trajectory-report.ts` is a byte copy of the repository file with one
hand-written measurement added: a `0.88` success rate and the helper that prints it.

A10 requires every printed trajectory measurement to be recomputed from the JSONL run records, so
the `scoring` gate must reject the literal. `packages/verify/test/trajectory-evidence.test.ts` runs
the real gate over this overlay and asserts that rejection.
`packages/verify/test/selftest-drift.test.ts` strips the injected region and compares the remainder
with the real file, which keeps the copy from drifting.
