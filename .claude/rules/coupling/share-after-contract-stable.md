---
paths:
  - "**/*.ts"
---

# Share behavior only after the contract is stable

Prefer small local duplication when two callers have different reasons to change.
Extract shared code when inputs, outputs, failure behavior, and ownership are the same.
Avoid flags that make one helper implement several workflows.
Delete an abstraction that has only one meaningful caller.

Source: adapted from Toss Frontend Fundamentals coupling guidance.
