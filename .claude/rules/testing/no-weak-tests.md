---
paths:
  - "**/*.test.ts"
---

# Reject weak or bypassed tests

Do not use skipped or focused tests, automatic update flags, or assertions that only prove a value exists.
Assert the exact return value, state change, output bytes, or outgoing effect.
A regression test must fail when the protected branch is inverted or removed.
Reproduce a bug through a user-aligned public boundary before fixing it.

Source: docs/reference/verification.md forbidden-pattern and test gates.
