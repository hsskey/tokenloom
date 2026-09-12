---
paths:
  - "**/*.bench.ts"
  - "bench/**"
---

# Keep benchmarks reproducible

Use deterministic synthetic inputs or committed sample data.
Warm the operation when the target is a warm measurement.
Append structured results through pnpm bench --json.
Read thresholds from docs/reference/verification.md and verifier configuration.
Do not overwrite historical results or present an environment-invalid run as a regression.

Source: docs/reference/verification.md benchmark gate.
