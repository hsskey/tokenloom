---
paths:
  - "packages/parser/src/**/*.ts"
  - "packages/tokens/src/**/*.ts"
  - "apps/cli/src/**/*.ts"
---

# Return recoverable design issues as warnings

Represent supported warning conditions with the codes in docs/reference/spec.md.
Continue producing output for recoverable issues.
Let --strict promote warnings to the documented strict exit category.
Reserve fatal failure for invalid input, ambiguity that requires user choice, or an operation that cannot produce a meaningful result.

Source: docs/reference/spec.md CLI and warning contracts.
