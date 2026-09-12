---
paths:
  - "**/*.ts"
---

# Separate code that does not execute together

Split independent branches into focused operations when doing so clarifies their inputs and effects.
Keep a short shared setup before the branch.
Avoid a function that prepares data for several mutually exclusive workflows.
Prefer early returns when they make the valid path linear.

Source: adapted from Toss Frontend Fundamentals readability guidance.
