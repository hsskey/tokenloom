---
paths:
  - "packages/adapters/**/*.ts"
  - "packages/cache/src/**/*.ts"
  - "tokenloom.config.ts"
---

# Route Figma calls through the budget ledger

Every REST Tier 1 or MCP call must match a capability in the plan matrix in docs/reference/spec.md section 0.
Read the selected plan from tokenloom.config.ts.
Reserve budget before sending a request, persist the result after it returns, and reject a request before the network call when any window would be exceeded.
Do not infer remaining quota from absent response headers.
Apply the retry policy from docs/reference/spec.md rather than adding an unbounded retry loop.

Source: docs/goals.md invariants and docs/reference/spec.md sections 0 and 4.10.
