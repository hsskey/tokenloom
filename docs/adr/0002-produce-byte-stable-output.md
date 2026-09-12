# Produce byte-stable output

The reference and determinism gates verify this contract; see `docs/reference/verification.md`.
tokenloom sorts order-insensitive data and uses stable serialization so identical snapshots produce identical bytes.
This makes reference-output comparison and committed verification evidence meaningful, at the cost of forbidding time, randomness, and incidental insertion order in generated artifacts.
