---
paths:
  - "packages/{schema,parser,tokens,cache}/src/**/*.ts"
  - "apps/cli/src/**/*.ts"
---

# Produce stable bytes

Do not let current time, randomness, object insertion order, or unordered source arrays affect deterministic output.
Sort order-insensitive collections with an explicit comparator.
Use stableStringify for output JSON.
Keep provenance timestamps in adapter inputs, outside derived content.
Confirm repeated output through the determinism gate, which reruns each command on shuffled input.

Source: docs/goals.md invariants and the determinism gate in docs/reference/verification.md.
