---
paths:
  - "**/*.test.ts"
---

# Reject generated-test anti-patterns

A test must fail when the protected behavior is removed.
Do not test private helpers, framework behavior, or values merely echoed from a stub.
Avoid mocking pure functions and same-module collaborators.
Use table-driven cases instead of copied test bodies.
Assert one exit-point type per test.

Source: adapted from The Art of Unit Testing.
