# Verification self-test samples

Each sample lives in `verify/selftest/<gate>/<sample name>/`.
Its `apply/` directory holds files that overwrite the repository copy at the same relative path.
A `remove.txt` file lists paths to delete instead.

The self-test gate copies the repository into a temporary directory, symlinks `node_modules`, applies one sample, and runs the owner gate plus every required gate that overlay can change, as defined in `docs/reference/verification.md` sections 2 and 8.
A skipped collateral gate is recorded in `skippedGates` with reason `unreachable`; benchmark skips also appear in `notRunByScope`. Neither list is a pass or a failure, and those gates are excluded from the sample's collateral checks.
The expected result is that only the sample's own gate fails and every in-scope collateral gate is unaffected.

When a sample also breaks another gate legitimately - `it.skip` violates both the `tests` and `patterns` gates, for example - name that gate on its own line in `expect-also.txt`.
That file does not reduce checking.
It records an overlap that the gate contract table in `docs/reference/verification.md` section 2 already defines.

Every gate excludes this directory from its scan, because the samples are deliberate instances of the patterns those gates reject.

Every sample runs on every verification.
The self-test records the per-gate sample count in `verify.json`, and a gate with no sample appears in `coverageWarnings`.
