---
paths:
  - "**/*.ts"
---

# Use operation-specific names

Name functions for the domain action and result they provide.
Avoid broad names such as request, process, or handle when a more specific operation exists.
Distinguish reading, normalizing, validating, writing, and sending.
Keep aliases only at explicit compatibility boundaries.

Source: adapted from Toss Frontend Fundamentals predictability guidance.
