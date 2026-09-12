---
paths:
  - "**/*.mutations.test.ts"
  - "samples/mutations/**"
---

# Match mutation outcomes exactly

Run every mutation through the public command boundary.
Compare the complete warning-code set and exit category with samples/mutations/expected.json.
Do not weaken an expectation when implementation changes.
Update the canonical SPEC table and its machine-readable copy together after an explicit contract decision.

Source: docs/reference/spec.md mutation table and the mutation gate.
