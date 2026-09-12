---
paths:
  - "**/*.ts"
---

# Keep related return shapes consistent

Functions in the same family should represent success, absence, and failure the same way.
Do not mix thrown errors, nullable values, and result objects for equivalent operations.
Use a compatibility wrapper when an old public shape must remain supported.
Make callers handle every discriminated case.

Source: adapted from Toss Frontend Fundamentals predictability guidance.
