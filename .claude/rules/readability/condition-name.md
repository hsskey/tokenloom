---
paths:
  - "**/*.ts"
---

# Name complex conditions

Extract a boolean when its name explains a policy better than the expression.
Keep the name near the branch that consumes it.
Avoid negated names and double negatives.
Do not extract a trivial comparison that is already clearer inline.

Source: adapted from Toss Frontend Fundamentals readability guidance.
