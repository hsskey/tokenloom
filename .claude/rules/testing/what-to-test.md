---
paths:
  - "**/*.test.ts"
---

# Test behavior with meaningful risk

Prioritize branching policy, transformations, error categories, serialization, and outgoing effects.
Skip generated boilerplate, trivial accessors, and pure delegation.
Test through the public API of the unit.
Choose integration or CLI coverage when isolating the seam would require testing implementation details.

Source: adapted from The Art of Unit Testing.
