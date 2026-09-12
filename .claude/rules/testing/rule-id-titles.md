---
paths:
  - "**/*.rules.test.ts"
---

# Prefix rule tests with SPEC IDs

Begin each rule-test description with the exact rule ID it covers.
Follow the ID with an English description of observable behavior.
Keep one concrete assertion target per test.
The rule-traceability gate matches every rule ID in the specification against a test title, so an implementation whose title omits the ID counts as uncovered.

Source: docs/reference/spec.md rule table and the rule-traceability gate.
