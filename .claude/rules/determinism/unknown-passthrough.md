---
paths:
  - "packages/parser/src/**/*.ts"
---

# Preserve unknown nodes with a warning

Do not fail an entire design because a new Figma node type appears.
Map unsupported types to role: unknown, preserve the available structure, and emit UNKNOWN_NODE_TYPE.
Keep output deterministic and let strict mode decide whether warnings fail the command.

Source: docs/goals.md invariants and docs/reference/spec.md node rules.
