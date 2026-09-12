---
paths:
  - "**/*.ts"
---

# Colocate files that change together

Place code by the domain operation it supports.
Keep a helper near its callers until several independent areas need it.
Move code only when the new location reduces cross-directory edits.
Avoid generic utility directories that hide ownership.

Source: adapted from Toss Frontend Fundamentals cohesion guidance.
