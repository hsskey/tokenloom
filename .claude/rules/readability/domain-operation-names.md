---
paths:
  - "**/*.ts"
---

# Hide low-level steps behind a domain operation

Let orchestration read as a sequence of meaningful actions.
Move parsing, protocol, and storage details behind focused functions.
Keep error categories visible to the caller.
Do not hide a product decision inside a generic helper.

Source: adapted from Toss Frontend Fundamentals readability guidance.
