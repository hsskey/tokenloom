---
paths:
  - "**/*.ts"
---

# Keep conditional expressions simple

Use a ternary for one short value choice.
Use a named condition or ordinary branch for nested logic, side effects, or several clauses.
Do not chain ternaries.
Keep both arms at the same abstraction level.

Source: adapted from Toss Frontend Fundamentals readability guidance.
