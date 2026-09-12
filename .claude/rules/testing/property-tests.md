---
paths:
  - "**/*.props.test.ts"
---

# Preserve the property contracts

Keep every property aligned with docs/reference/verification.md section 6.
Generate bounded, valid data with enough variation to exercise structure and ordering.
When a counterexample appears, preserve a minimal reproduction and fix production code.
Do not filter away a valid failing case.

Source: docs/reference/verification.md property and benchmark gates.
