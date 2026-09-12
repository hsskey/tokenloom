---
paths:
  - "packages/schema/src/**/*.ts"
  - "packages/parser/src/**/*.ts"
  - "packages/tokens/src/**/*.ts"
---

# Keep Figma fields behind Snapshot

Parsers and token builders accept the repository Snapshot contract.
Figma REST and Plugin API field names belong in packages/adapters/.
Normalize at the adapter boundary and keep downstream code independent of transport response shapes.
Extend Snapshot explicitly when the core needs new information.

Source: docs/goals.md invariants and docs/reference/spec.md section 1.
