---
paths:
  - "**/*.test.ts"
  - "**/*.bench.ts"
---

# Choose the smallest test level that proves behavior

Use a unit test for isolated deterministic logic, an integration test for a package boundary, and a black-box CLI test for a user-visible contract.
Cover branches, transformations, and side effects that can regress.
Treat coverage numbers as diagnostic information rather than the definition of done.
Keep critical compatibility boundaries covered at the public surface.

Source: adapted from The Art of Unit Testing and repository gate contracts.
