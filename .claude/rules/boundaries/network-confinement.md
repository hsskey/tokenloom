---
paths:
  - "packages/**/src/**/*.ts"
  - "apps/**/src/**/*.ts"
---

# Confine network access

Only the REST adapter and evaluation adapter may initiate network requests.
Token extraction, parsing, design-context construction, cache operations, and emitters remain local and deterministic.
Pass external data into the core as a validated Snapshot.
Do not hide network access behind a utility imported by a core package.

Source: docs/goals.md invariants and the forbidden-pattern gate.
