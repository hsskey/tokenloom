---
paths:
  - "**/*.ts"
---

# Split functions by coherent operation

Group statements that transform the same data toward one result.
Separate validation, transformation, persistence, and presentation when their inputs or failure modes differ.
Pass the smallest value required by the next operation.
Avoid splitting only to reduce line count.

Source: adapted from Toss Frontend Fundamentals readability guidance.
